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

/** Максимум двух дат (null трактуется как «нет значения»). */
function maxDate(a: Date | null | undefined, b: Date): Date {
  return a && a.getTime() > b.getTime() ? a : b
}

export async function applyInvoicePayment(
  tx: Prisma.TransactionClient,
  opts: ApplyInvoicePaymentOpts
): Promise<ApplyInvoicePaymentResult> {
  const invoice = await tx.billingInvoice.findUnique({
    where: { id: opts.invoiceId },
    include: {
      organization: { select: { id: true, billingStatus: true } },
      subscription: { select: { id: true, periodEndDate: true, nextPaymentDate: true } },
    },
  })
  if (!invoice) {
    throw new Error(`Счёт ${opts.invoiceId} не найден`)
  }
  if (invoice.status === "paid") {
    return { applied: false, organizationId: invoice.organizationId, unblocked: false }
  }

  const paidAt = opts.paidAt ?? new Date()

  await tx.billingInvoice.update({
    where: { id: invoice.id },
    data: {
      status: "paid",
      paidAt,
      paidAmount: opts.paidAmount ?? invoice.amount,
      paidVia: opts.paidVia,
      ...(opts.comment
        ? { comment: invoice.comment ? `${invoice.comment} | ${opts.comment}` : opts.comment }
        : {}),
    },
  })

  const subUpdate: Prisma.BillingSubscriptionUpdateInput = {}

  // Продление расписания — только для полноценного периодного счёта. Доплатный
  // счёт (перерасчёт филиалов) покрывает лишь хвост уже оплаченного периода и
  // расписание не двигает. Монотонность (max) страхует от отката при поздней
  // оплате более раннего счёта после аванса за следующий период.
  if (!invoice.isAdjustment) {
    const pe = invoice.periodEnd
    const nextPaymentDate = new Date(
      Date.UTC(pe.getUTCFullYear(), pe.getUTCMonth(), pe.getUTCDate() + 1)
    )
    subUpdate.periodEndDate = maxDate(invoice.subscription.periodEndDate, pe)
    subUpdate.nextPaymentDate = maxDate(
      invoice.subscription.nextPaymentDate,
      nextPaymentDate
    )
  }

  // Разблокировка — только если у организации не осталось других ПРОСРОЧЕННЫХ
  // счетов. Блокировка всегда наступает через overdue (blockOverdueBilling), а
  // будущие pending-счета блок не держат (иначе оплата просрочки не
  // разблокировала бы орг, которой генератор уже выставил следующий период).
  // Это же закрывает обход блокировки: доплатный счёт при неоплаченном основном
  // не снимет блок, т.к. основной к тому моменту уже overdue.
  const otherOverdue = await tx.billingInvoice.count({
    where: {
      organizationId: invoice.organizationId,
      id: { not: invoice.id },
      status: "overdue",
    },
  })
  const canUnblock = otherOverdue === 0

  if (canUnblock) {
    subUpdate.status = "active"
    subUpdate.blockedAt = null
    subUpdate.gracePeriodEnd = null
  }

  if (Object.keys(subUpdate).length > 0) {
    await tx.billingSubscription.update({
      where: { id: invoice.subscriptionId },
      data: subUpdate,
    })
  }

  const unblocked = canUnblock && invoice.organization.billingStatus !== "active"
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

/**
 * Отмена счёта: статус → cancelled, уведомления «оплатите счёт» скрываются,
 * и (если счёт был неоплачен) учтённый в нём кредит возвращается организации —
 * иначе предоплаченный кредит сгорал бы вместе с отменённым счётом.
 */
export async function cancelInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  const invoice = await tx.billingInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      creditApplied: true,
      subscriptionId: true,
      organizationId: true,
      organization: { select: { billingStatus: true } },
    },
  })
  if (!invoice || invoice.status === "cancelled") return

  const credit = Number(invoice.creditApplied || 0)
  if (credit > 0 && invoice.status !== "paid") {
    await tx.billingSubscription.update({
      where: { id: invoice.subscriptionId },
      data: { creditBalance: { increment: credit } },
    })
  }

  await tx.billingInvoice.update({
    where: { id: invoice.id },
    data: { status: "cancelled", creditApplied: 0 },
  })

  // Если отменён был последний ПРОСРОЧЕННЫЙ долг заблокированной орг — снимаем
  // блокировку (иначе орг зависла бы в read-only без счёта для реактивации).
  if (invoice.organization.billingStatus !== "active") {
    const remainingOverdue = await tx.billingInvoice.count({
      where: {
        organizationId: invoice.organizationId,
        id: { not: invoice.id },
        status: "overdue",
      },
    })
    if (remainingOverdue === 0) {
      await tx.organization.update({
        where: { id: invoice.organizationId },
        data: { billingStatus: "active" },
      })
      // updateMany с guard'ом — не «оживляем» отменённую подписку
      await tx.billingSubscription.updateMany({
        where: { id: invoice.subscriptionId, status: { not: "cancelled" } },
        data: { status: "active", blockedAt: null, gracePeriodEnd: null },
      })
    }
  }

  await tx.notification.deleteMany({
    where: {
      tenantId: invoice.organizationId,
      type: "billing_invoice",
      entityType: "BillingInvoice",
      entityId: invoice.id,
    },
  })
}

/** Обёртка с собственной транзакцией — для одиночных вызовов (админка, webhook) */
export async function cancelInvoiceById(invoiceId: string) {
  return db.$transaction((tx) => cancelInvoice(tx, invoiceId))
}
