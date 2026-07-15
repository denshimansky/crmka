// Автоблокировка неплательщиков (1-е число месяца).
//
// Счета pending с dueDate <= сегодня (срок оплаты — 1-е число, «не позднее
// начала оказания услуг») переводятся в overdue, организация —
// в billingStatus=blocked (read-only режим, см. middleware), подписка —
// в blocked + blockedAt.
//
// Идемпотентность и ручная разблокировка: блокировка срабатывает только на
// переходе pending → overdue. Повторный прогон (retry/workflow_dispatch)
// pending-счетов не найдёт и НЕ перезатрёт ручную разблокировку админа —
// она доживёт до следующего 1-го числа (нового неоплаченного счёта).
//
// exempt-организации не блокируются.

import { db } from "@/lib/db"

export interface BlockOverdueResult {
  blocked: { orgName: string; invoiceNumbers: string[] }[]
  invoicesMarkedOverdue: number
}

export async function blockOverdueBilling(now: Date = new Date()): Promise<BlockOverdueResult> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const dueInvoices = await db.billingInvoice.findMany({
    where: {
      status: "pending",
      dueDate: { lte: today },
      organization: { billingExempt: false },
    },
    include: { organization: { select: { id: true, name: true } } },
  })

  const result: BlockOverdueResult = { blocked: [], invoicesMarkedOverdue: 0 }
  if (dueInvoices.length === 0) return result

  // Группируем по организации: блокируем один раз, счета помечаем все
  const byOrg = new Map<string, typeof dueInvoices>()
  for (const inv of dueInvoices) {
    const list = byOrg.get(inv.organizationId) || []
    list.push(inv)
    byOrg.set(inv.organizationId, list)
  }

  for (const [orgId, invoices] of byOrg) {
    await db.$transaction(async (tx) => {
      // Переход pending → overdue под условием статуса (гонка с оплатой:
      // если счёт успели оплатить между выборкой и транзакцией — не трогаем)
      const claimed = await tx.billingInvoice.updateMany({
        where: { id: { in: invoices.map((i) => i.id) }, status: "pending" },
        data: { status: "overdue" },
      })
      if (claimed.count === 0) return

      await tx.organization.update({
        where: { id: orgId },
        data: { billingStatus: "blocked" },
      })
      await tx.billingSubscription.updateMany({
        where: {
          id: { in: invoices.map((i) => i.subscriptionId) },
          status: { not: "cancelled" },
        },
        data: { status: "blocked", blockedAt: now },
      })

      result.invoicesMarkedOverdue += claimed.count
      result.blocked.push({
        orgName: invoices[0].organization.name,
        invoiceNumbers: invoices.map((i) => i.number),
      })
    })
  }

  return result
}
