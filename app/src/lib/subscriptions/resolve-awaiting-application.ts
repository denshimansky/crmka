import { Prisma } from "@prisma/client"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"
import { recordClientStatusChange } from "@/lib/clients/status-history"
import { wasEverClient } from "@/lib/clients/was-ever-client"

/**
 * Закрывает зависшую заявку «Ожидаем оплату» при завершении жизни абонемента
 * (отчисление/закрытие), выписанного по ней (баг #62).
 *
 * Заявка выигрывается штатно только при АКТИВАЦИИ абонемента (полная оплата,
 * activate-subscription). Частично оплаченный абонемент остаётся pending, и
 * если ребёнка затем отчислить — заявка навсегда зависала в «Ожидаем оплату».
 *
 * Guard'ы (порядок важен, каждый отсекает ложное закрытие ЧУЖОЙ заявки):
 *  1) только pending и никогда не активированный абонемент: активированный
 *     свою заявку уже выиграл при активации, его отчисление не должно трогать
 *     чужую awaiting-заявку (например, новую продажу другого месяца);
 *  2) у ребёнка нет другого живого (pending/active) абонемента того же
 *     направления — иначе заявка продолжает ждать его оплату (выписаны два
 *     месяца, отчислили один);
 *  3) матчинг заявки строго по ребёнку+направлению, БЕЗ фоллбэка «единственная
 *     awaiting-заявка»: в отличие от activate-subscription (там событие —
 *     полная оплата ЭТОГО абонемента), здесь одинокая заявка другого
 *     направления почти наверняка чужая живая сделка.
 *
 * Исход: netPaid > 0 → 'won' (продажа состоялась — видно в /crm/sales и
 * карточке клиента; в отчёте воронки CRM-13 «Купил» считается по дате
 * АКТИВАЦИИ, поэтому туда частично оплаченные отчисления осознанно не
 * попадают); netPaid = 0 → 'potential', и контакт возвращается в
 * «Потенциальные» (как при ручной обработке заявки), если клиент не активный.
 */
export async function resolveAwaitingApplicationOnSubscriptionEnd(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string
    subscription: {
      id: string
      clientId: string
      wardId: string | null
      directionId: string
      /** Статус ДО завершения — резолвим только pending. */
      status: string
      /** Абонемент когда-либо активировался — заявка уже выиграна, не трогаем. */
      activatedAt: Date | null
    }
    /** Нетто-оплачено по абонементу (netPaidToSubscription). */
    netPaid: Prisma.Decimal
    employeeId?: string | null
    at?: Date
  },
): Promise<void> {
  const { tenantId, subscription: sub } = opts
  if (!sub.wardId) return
  if (sub.status !== "pending" || sub.activatedAt) return

  // Только pending: awaiting-заявку может разрешить лишь неактивированный
  // абонемент (оплатой через activate-subscription или своим концом жизни
  // здесь). Активный абонемент того же направления заявку не разрешит никогда
  // (его активация уже выиграла все awaiting-заявки НА ТОТ момент) — ждать его
  // значило бы подвесить заявку до ручной обработки.
  const otherLive = await tx.subscription.findFirst({
    where: {
      tenantId,
      wardId: sub.wardId,
      directionId: sub.directionId,
      id: { not: sub.id },
      deletedAt: null,
      status: "pending",
    },
    select: { id: true },
  })
  if (otherLive) return

  const outcome = opts.netPaid.greaterThan(0) ? ("won" as const) : ("potential" as const)
  const updated = await tx.application.updateMany({
    where: {
      tenantId,
      wardId: sub.wardId,
      directionId: sub.directionId,
      status: "active",
      stage: "awaiting_payment",
      deletedAt: null,
    },
    data: {
      status: "processed",
      processedToStatus: outcome,
      processedAt: opts.at ?? new Date(),
      processedBy: opts.employeeId ?? undefined,
    },
  })
  if (updated.count === 0) return

  // Не купил — контакт возвращается в «Потенциальные» (зеркально ручной
  // обработке заявки в process-роуте). В потенциал уходят только лиды/не-клиенты:
  // бывшего (или текущего активного) клиента НЕ возвращаем в «Потенциальный»
  // (правило 31.07, planFormerClientTransition R1) — иначе закрытие заявки как
  // «Потенциал» перекрыло бы статус «Выбывший» и такой клиент всплыл бы в обзвоне
  // по потенциалу. wasEverClient ловит и active (clientStatus="active"), и
  // churned, и однажды плативших.
  if (outcome === "potential") {
    const before = await tx.client.findUnique({
      where: { id: sub.clientId },
      select: {
        funnelStatus: true,
        clientStatus: true,
        firstPaymentDate: true,
        firstPaidLessonDate: true,
      },
    })
    if (before && !wasEverClient(before) && before.funnelStatus !== "potential") {
      await tx.client.updateMany({
        where: { id: sub.clientId, tenantId },
        data: { funnelStatus: "potential" },
      })
      await recordClientStatusChange(tx, {
        tenantId,
        clientId: sub.clientId,
        employeeId: opts.employeeId ?? null,
        funnel: { old: before.funnelStatus, new: "potential" },
        reason: "subscription_ended_unpaid",
      })
    }
  }
  await recomputeWardSalesStage(tx, tenantId, sub.wardId, opts.at ?? new Date())
}
