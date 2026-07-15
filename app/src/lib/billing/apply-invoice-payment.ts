// Единая точка «счёт оплачен»: счёт → paid, подписка → active + продление,
// организация → разблокировка, уведомления «оплатите счёт» → удаляются.
// Вызывается из крона проверки выписки Т-Банк, админского «Отметить
// оплаченным» и webhook-обработчика.

import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"

export type PaidVia = "bank_transfer" | "manual" | "tbank_api"

export interface ApplyInvoicePaymentOpts {
  invoiceId: string
  paidVia: PaidVia
  /** По умолчанию — сумма счёта */
  paidAmount?: number
  /** По умолчанию — сейчас */
  paidAt?: Date
  /** Дописывается к комментарию счёта (например, реквизиты банковской операции) */
  comment?: string
}

export interface ApplyInvoicePaymentResult {
  /** false — счёт уже был оплачен (no-op) */
  applied: boolean
  organizationId: string
  /** Организация была заблокирована/в грейсе и разблокирована этой оплатой */
  unblocked: boolean
}

export async function applyInvoicePayment(
  tx: Prisma.TransactionClient,
  opts: ApplyInvoicePaymentOpts
): Promise<ApplyInvoicePaymentResult> {
  const invoice = await tx.billingInvoice.findUnique({
    where: { id: opts.invoiceId },
    include: { organization: { select: { id: true, billingStatus: true } } },
  })
  if (!invoice) {
    throw new Error(`Счёт ${opts.invoiceId} не найден`)
  }
  if (invoice.status === "paid") {
    return { applied: false, organizationId: invoice.organizationId, unblocked: false }
  }

  await tx.billingInvoice.update({
    where: { id: invoice.id },
    data: {
      status: "paid",
      paidAt: opts.paidAt ?? new Date(),
      paidAmount: opts.paidAmount ?? invoice.amount,
      paidVia: opts.paidVia,
      ...(opts.comment
        ? { comment: invoice.comment ? `${invoice.comment} | ${opts.comment}` : opts.comment }
        : {}),
    },
  })

  // periodEnd — последний день оплаченного периода ⇒ следующая оплата на другой день
  const pe = invoice.periodEnd
  const nextPaymentDate = new Date(
    Date.UTC(pe.getUTCFullYear(), pe.getUTCMonth(), pe.getUTCDate() + 1)
  )

  await tx.billingSubscription.update({
    where: { id: invoice.subscriptionId },
    data: {
      status: "active",
      periodEndDate: invoice.periodEnd,
      nextPaymentDate,
      blockedAt: null,
      gracePeriodEnd: null,
    },
  })

  const unblocked = invoice.organization.billingStatus !== "active"
  if (unblocked) {
    await tx.organization.update({
      where: { id: invoice.organizationId },
      data: { billingStatus: "active" },
    })
  }

  // Скрываем «оплатите счёт» из колокольчика у всех получателей
  await tx.notification.deleteMany({
    where: {
      tenantId: invoice.organizationId,
      type: "billing_invoice",
      entityType: "BillingInvoice",
      entityId: invoice.id,
    },
  })

  return { applied: true, organizationId: invoice.organizationId, unblocked }
}

/** Обёртка с собственной транзакцией — для одиночных вызовов (админка, webhook) */
export async function applyInvoicePaymentById(
  opts: ApplyInvoicePaymentOpts
): Promise<ApplyInvoicePaymentResult> {
  return db.$transaction((tx) => applyInvoicePayment(tx, opts))
}

/** Отмена счёта: уведомления «оплатите счёт» тоже скрываем */
export async function removeInvoiceNotifications(invoiceId: string, tenantId: string) {
  await db.notification.deleteMany({
    where: {
      tenantId,
      type: "billing_invoice",
      entityType: "BillingInvoice",
      entityId: invoiceId,
    },
  })
}
