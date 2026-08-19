import { Prisma, type PrismaClient } from "@prisma/client"
import { logAuditTx } from "@/lib/audit"

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * События цены абонемента для истории клиента (карточка → вкладка «История»,
 * фильтр «Абонементы»). Пишутся в audit_logs с entityType="Subscription",
 * читает их GET /api/clients/[id]/timeline.
 *
 * Две записи с разным смыслом:
 *   action="create" — абонемент ВЫПИСАН: `finalAmount.new` — сумма, на которую
 *     выписали (уже со скидкой, если она легла при выписке);
 *   action="update" — абонемент ПЕРЕСЧИТАН: `finalAmount` = {old, new}, плюс
 *     `reason` и, если переплата вернулась родителю, `refunded`.
 *
 * Зачем отдельная запись на выписку: событие «Абонемент создан» в таймлайне
 * строится из живой строки Subscription, а её finalAmount пересчёт переписывает
 * — задним числом «менялась» и сумма, на которую абонемент когда-то выписали.
 *
 * Обе записи пишутся ВНУТРИ транзакции выписки/пересчёта (logAuditTx): событие
 * без самой мутации — или мутация без события — врали бы об истории денег.
 */
export async function logSubscriptionIssued(
  tx: Tx,
  params: {
    tenantId: string
    subscriptionId: string
    /** Итоговая сумма ПОСЛЕ скидок, положенных при выписке. */
    finalAmount: Prisma.Decimal | number | string
    employeeId?: string | null
  },
): Promise<void> {
  await logAuditTx(tx, {
    tenantId: params.tenantId,
    employeeId: params.employeeId ?? null,
    action: "create",
    entityType: "Subscription",
    entityId: params.subscriptionId,
    changes: issuedChanges(params.finalAmount),
  })
}

/**
 * Пакетный вариант для массовой выписки: один INSERT вместо N — цикл создания
 * абонементов и так живёт в длинной транзакции (см. таймаут в bulk-renew).
 * Формат записи тот же, что у logSubscriptionIssued.
 */
export async function logSubscriptionsIssued(
  tx: Tx,
  params: {
    tenantId: string
    employeeId?: string | null
    items: { subscriptionId: string; finalAmount: Prisma.Decimal | number | string }[]
  },
): Promise<void> {
  if (params.items.length === 0) return
  await tx.auditLog.createMany({
    data: params.items.map((i) => ({
      tenantId: params.tenantId,
      employeeId: params.employeeId ?? null,
      action: "create",
      entityType: "Subscription",
      entityId: i.subscriptionId,
      changes: issuedChanges(i.finalAmount),
    })),
  })
}

function issuedChanges(finalAmount: Prisma.Decimal | number | string) {
  return { finalAmount: { new: new Prisma.Decimal(finalAmount).toFixed(2) } }
}

export async function logSubscriptionRepriced(
  tx: Tx,
  params: {
    tenantId: string
    subscriptionId: string
    oldAmount: Prisma.Decimal
    newAmount: Prisma.Decimal
    /** Почему цена изменилась — человекочитаемо, для строки в истории. */
    reason: string
    /** Сколько переплаты вернулось на баланс родителя (0 — не пишем). */
    refunded?: Prisma.Decimal
    employeeId?: string | null
  },
): Promise<void> {
  await logAuditTx(tx, {
    tenantId: params.tenantId,
    employeeId: params.employeeId ?? null,
    action: "update",
    entityType: "Subscription",
    entityId: params.subscriptionId,
    changes: {
      finalAmount: { old: params.oldAmount.toFixed(2), new: params.newAmount.toFixed(2) },
      reason: { new: params.reason },
      ...(params.refunded && params.refunded.greaterThan(0)
        ? { refunded: { new: params.refunded.toFixed(2) } }
        : {}),
    },
  })
}
