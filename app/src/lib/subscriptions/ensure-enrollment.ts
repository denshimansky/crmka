// Зачисление ребёнка (или клиента-взрослого без подопечного) в группу при
// выписке абонемента. Общая логика одиночной выписки (POST /api/subscriptions),
// массовой/поштучной выписки (bulk-renew) и реанимации пакета (продление
// expiresAt закрытого пакета).
//
// GroupEnrollment один на (group, client, ward) и переживает месяцы, поэтому
// новый абонемент должен:
//   - создать зачисление, если его нет: paymentStatus='awaiting_payment' —
//     «занятия в группе есть, но абонемент ещё не оплачен». При оплате
//     (pay-from-balance / activateSubscription) статус переводится в 'active'
//     через updateMany — поэтому запись должна существовать ДО
//     recalcClientDiscounts (который может активировать абонемент со 100%
//     скидкой). Без этой записи абонемент был бы активным и привязанным к
//     группе, но ребёнок не попадал в группу и в таблицы посещений. Зеркалит
//     move-to-awaiting-payment;
//   - реактивировать выбывшее (isActive=false / withdrawnAt), различая два случая:
//     ПРОДОЛЖЕНИЕ — прошлый месяц штатно закрыт (крон автозакрытия деактивировал
//     зачисление, выписка нового месяца идёт после 1-го числа): историю СОХРАНЯЕМ
//     (enrolledAt = min(existing, startDate)), иначе ребёнок ретроактивно исчез бы
//     из состава всех прошлых занятий (фильтры enrolledAt <= date). Признак:
//     последний завершённый абонемент ребёнка в группе — closed (не withdrawn)
//     И выбытие свежее (withdrawnAt >= 1-е число месяца перед startDate).
//     ВОЗВРАТ после отчисления/долгого гэпа — зачисляем заново от startDate
//     (в прошлых занятиях гэпа он не участвует). withdrawnAt снимаем в обоих
//     случаях, иначе фильтр состава (withdrawnAt > lesson.date) продолжит
//     прятать ребёнка;
//   - для живого зачисления — поддержать дату задним числом
//     (enrolledAt = min(existing, startDate)), чтобы не потерять более раннюю
//     историю (например, пробное до startDate), и НЕ трогать paymentStatus:
//     иначе оплаченный прошлый месяц получит ложный бейдж «Ожидаем оплату»
//     (paymentStatus — поле на всё зачисление, не на период).

import { Prisma, type PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

export interface EnsureEnrollmentInput {
  tenantId: string
  groupId: string
  clientId: string
  /** Подопечный; null — взрослый абонемент самого клиента. */
  wardId: string | null
  /** Начало действия абонемента — от него считается enrolledAt. */
  startDate: Date
}

/**
 * Гарантирует живое зачисление (isActive=true, withdrawnAt=null) для
 * (group, client, ward): создаёт новое, реактивирует выбывшее или поддерживает
 * enrolledAt существующего. Идемпотентна.
 */
export async function ensureEnrollmentForSubscription(
  tx: Tx,
  input: EnsureEnrollmentInput,
): Promise<void> {
  const existing = await tx.groupEnrollment.findFirst({
    where: {
      tenantId: input.tenantId,
      groupId: input.groupId,
      clientId: input.clientId,
      wardId: input.wardId,
      deletedAt: null,
    },
    // На (group, client, ward) может оказаться >1 не-удалённой записи
    // (например после переводов между группами туда-обратно) — детерминированно
    // берём живую/самую свежую, чтобы не реактивировать вторую и не задвоить.
    orderBy: [{ isActive: "desc" }, { enrolledAt: "desc" }],
  })

  if (existing) {
    const wasWithdrawn = !existing.isActive || existing.withdrawnAt !== null
    // Продолжение после штатного закрытия vs возврат после отчисления/гэпа —
    // см. комментарий модуля. Проверяем только для выбывшего зачисления.
    let isContinuation = false
    if (wasWithdrawn && existing.enrolledAt && existing.withdrawnAt) {
      const lastFinished = await tx.subscription.findFirst({
        where: {
          tenantId: input.tenantId,
          groupId: input.groupId,
          clientId: input.clientId,
          wardId: input.wardId,
          deletedAt: null,
          status: { in: ["closed", "withdrawn"] },
        },
        orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
        select: { status: true },
      })
      // Граница свежести — 1-е число месяца перед startDate: закрытие ставит
      // withdrawnAt внутри/на границе закрытого месяца, т.е. не раньше неё.
      const prevMonthStart = new Date(
        Date.UTC(input.startDate.getUTCFullYear(), input.startDate.getUTCMonth() - 1, 1),
      )
      isContinuation =
        lastFinished?.status === "closed" && existing.withdrawnAt >= prevMonthStart
    }
    const enrolledAt =
      !existing.enrolledAt || (wasWithdrawn && !isContinuation)
        ? input.startDate
        : new Date(Math.min(existing.enrolledAt.getTime(), input.startDate.getTime()))
    await tx.groupEnrollment.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        enrolledAt,
        withdrawnAt: null,
        // Вернувшегося — в awaiting_payment (новый абонемент не оплачен).
        ...(wasWithdrawn ? { paymentStatus: "awaiting_payment" as const } : {}),
      },
    })
  } else {
    await tx.groupEnrollment.create({
      data: {
        tenantId: input.tenantId,
        groupId: input.groupId,
        clientId: input.clientId,
        wardId: input.wardId,
        paymentStatus: "awaiting_payment",
        isActive: true,
        enrolledAt: input.startDate,
      },
    })
  }
}
