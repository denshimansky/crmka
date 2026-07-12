import { Prisma } from "@prisma/client"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"

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
  // обработке заявки в process-роуте); активного клиента не трогаем.
  // clientStatus nullable (у чистых лидов NULL), а SQL `<> 'active'` NULL не
  // матчит — нужен явный OR с null, иначе основная аудитория (лиды) пропускается.
  if (outcome === "potential") {
    await tx.client.updateMany({
      where: {
        id: sub.clientId,
        tenantId,
        OR: [{ clientStatus: null }, { clientStatus: { not: "active" } }],
      },
      data: { funnelStatus: "potential" },
    })
  }
  await recomputeWardSalesStage(tx, tenantId, sub.wardId, opts.at ?? new Date())
}
