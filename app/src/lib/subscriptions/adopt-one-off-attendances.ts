import { Prisma, type PrismaClient } from "@prisma/client"
import { revertOneOffChargeForAttendance } from "@/lib/balance/revert-one-off-charge"
import { effectiveLessonPrice } from "@/lib/discounts/effective-price"
import { repriceSubscription } from "@/lib/discounts/recalc-client-discounts"
import { consumedTypeWhereFor } from "@/lib/subscriptions/consumed-lessons"
import { loadPackageSelections, packageSelectionGate } from "@/lib/subscriptions/subscription-lessons"
import { logAuditTx } from "@/lib/audit"

type DB = PrismaClient | Prisma.TransactionClient

export interface AdoptedOneOff {
  attendanceId: string
  lessonId: string
  date: Date
  /** Списано с абонемента за это занятие. */
  charged: Prisma.Decimal
  /** Возвращено на баланс родителя (снятое ранее разовое списание). */
  refunded: Prisma.Decimal
}

/**
 * Конец покрытия абонемента. У календарных `end_date` обычно пуст — период
 * задаётся periodYear/periodMonth (см. project_calendar_subs_null_enddate).
 */
export function coverageEnd(sub: {
  endDate: Date | null
  periodYear: number | null
  periodMonth: number | null
  expiresAt: Date | null
}): Date | null {
  if (sub.endDate) return sub.endDate
  if (sub.periodYear != null && sub.periodMonth != null) {
    // day=0 предыдущего месяца = последний день нужного (periodMonth 1-based).
    return new Date(Date.UTC(sub.periodYear, sub.periodMonth, 0))
  }
  return sub.expiresAt ?? null
}

/**
 * Подхват разовых посещений абонементом, выписанным ЗАДНИМ ЧИСЛОМ.
 *
 * Пока абонемента нет, отметка «Был» списывает занятие с БАЛАНСА родителя
 * (разовое посещение). Если потом на те же даты выписать абонемент, занятия
 * остаются разовыми: «Отработано 0/N», а стоимость занятий уже сидит в
 * `finalAmount` абонемента — клиент платит второй раз. Ровно этот сценарий дал
 * кейс Вершининой (04.09.2026) и ещё 15 клиентов в пяти организациях.
 *
 * Абонемент выписывается на занятия периода начиная со `startDate`, поэтому
 * `totalLessons` УЖЕ включает те занятия, что успели отметить разовыми, — не
 * подхватить их значит выставить счёт дважды. Отсюда подхват по умолчанию, а не
 * по галочке: сохраняется денежный инвариант «одно занятие оплачено один раз».
 *
 * Что делает по каждой подходящей отметке:
 *   1) возвращает разовое списание на баланс родителя (revertOneOffChargeForAttendance);
 *   2) привязывает отметку к абонементу и списывает с него по эффективной цене;
 *   3) в конце — repriceSubscription, чтобы finalAmount/balance сошлись со
 *      снимком фактических списаний.
 *
 * Границы (осознанно узкие — подхватываем только бесспорное):
 *   - та же группа, тот же ребёнок, дата занятия внутри покрытия абонемента;
 *   - только СПИСЫВАЮЩИЕ отметки: пропуски и «Назначена отработка» денег не
 *     несут, их семантика к абонементу не сводится;
 *   - не пробные и не отработки — это отдельные визиты со своей механикой;
 *   - не больше, чем свободных слотов (`totalLessons` − израсходовано): иначе
 *     абонемент спишет больше, чем в нём занятий. Берём самые ранние;
 *   - у пакета с явным выбором занятий — только занятия из набора.
 *
 * Вызывать ПОСЛЕ recalcClientDiscounts: списание идёт по цене со скидкой.
 * Идемпотентно: подхваченная отметка уже не `subscriptionId IS NULL`.
 *
 * @returns подхваченные отметки (пустой массив — обычный случай)
 */
export async function adoptOneOffAttendances(
  db: DB,
  input: { tenantId: string; subscriptionId: string; createdBy?: string | null },
): Promise<AdoptedOneOff[]> {
  const { tenantId, subscriptionId } = input
  const createdBy = input.createdBy ?? null

  const sub = await db.subscription.findFirst({
    where: { id: subscriptionId, tenantId, deletedAt: null },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      groupId: true,
      type: true,
      totalLessons: true,
      lessonPrice: true,
      discountPerLesson: true,
      startDate: true,
      endDate: true,
      periodYear: true,
      periodMonth: true,
      expiresAt: true,
    },
  })
  if (!sub) return []

  const until = coverageEnd(sub)
  // Без верхней границы окно не определено (пакет без срока) — не гадаем.
  if (!until) return []

  const candidates = await db.attendance.findMany({
    where: {
      tenantId,
      clientId: sub.clientId,
      subscriptionId: null,
      isTrial: false,
      isMakeup: false,
      isPending: false,
      // Абонемент на ребёнка подхватывает только его отметки; абонемент без
      // подопечного (взрослый клиент) — только отметки без подопечного.
      wardId: sub.wardId ?? null,
      attendanceType: { chargesSubscription: true },
      lesson: {
        groupId: sub.groupId,
        date: { gte: sub.startDate, lte: until },
      },
    },
    select: {
      id: true,
      lessonId: true,
      chargeAmount: true,
      lesson: { select: { date: true, groupId: true, group: { select: { directionId: true } } } },
    },
    orderBy: { lesson: { date: "asc" } },
  })
  if (candidates.length === 0) return []

  // Пакет с явным выбором занятий списывается только на выбранных (легаси-пакет
  // без строк выбора — gate=true, прежнее поведение).
  let eligible = candidates
  if (sub.type === "package") {
    const sel = await loadPackageSelections(db, tenantId, [sub.id])
    eligible = candidates.filter((a) => packageSelectionGate(sel, sub.id, a.lessonId))
    if (eligible.length === 0) return []
  }

  // Свободные слоты абонемента: сверх них подхватывать нельзя — списали бы
  // больше, чем в абонементе занятий.
  const consumed = await db.attendance.count({
    where: {
      tenantId,
      subscriptionId: sub.id,
      attendanceType: consumedTypeWhereFor(sub.type),
    },
  })
  const free = sub.totalLessons - consumed
  if (free <= 0) return []

  const price = effectiveLessonPrice(sub)
  const adopted: AdoptedOneOff[] = []

  for (const att of eligible.slice(0, free)) {
    const refunded = await revertOneOffChargeForAttendance(db, {
      tenantId,
      clientId: sub.clientId,
      attendanceId: att.id,
      lessonId: att.lessonId,
      directionId: att.lesson.group.directionId,
      createdBy,
    })

    await db.attendance.update({
      where: { id: att.id },
      data: { subscriptionId: sub.id, chargeAmount: price },
    })
    await db.subscription.update({
      where: { id: sub.id },
      data: { chargedAmount: { increment: price } },
    })

    adopted.push({
      attendanceId: att.id,
      lessonId: att.lessonId,
      date: att.lesson.date,
      charged: price,
      refunded,
    })
  }

  if (adopted.length === 0) return []

  // Выравниваем finalAmount/balance по фактическим списаниям.
  await repriceSubscription(db, { tenantId, subscriptionId: sub.id, createdBy })

  await logAuditTx(db, {
    tenantId,
    employeeId: createdBy,
    action: "update",
    entityType: "Subscription",
    entityId: sub.id,
    changes: {
      adoptedOneOffAttendances: {
        old: null,
        new: {
          lessons: adopted.length,
          charged: adopted.reduce((s, a) => s.plus(a.charged), new Prisma.Decimal(0)).toFixed(2),
          refundedToBalance: adopted
            .reduce((s, a) => s.plus(a.refunded), new Prisma.Decimal(0))
            .toFixed(2),
        },
      },
    },
  })

  return adopted
}
