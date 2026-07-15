import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  applyInvoicePaymentById,
  removeInvoiceNotifications,
} from "@/lib/billing/apply-invoice-payment"

/**
 * POST /api/billing/webhook
 *
 * Webhook-обработчик уведомлений от Т-Банк Business API.
 *
 * Т-Банк присылает POST-запрос при изменении статуса счёта.
 *
 * ВАЖНО:
 * - Т-Банк Business API (в отличие от Acquiring API) может НЕ поддерживать
 *   push-webhook для выставленных счетов. В текущей документации webhook
 *   для invoicing явно не описан.
 * - Как fallback: используется polling через getInvoiceStatus()
 *   или ручная отметка суперадмином.
 * - Этот endpoint подготовлен на случай, если Т-Банк добавит webhook
 *   или если мы будем получать банковские уведомления другим способом.
 *
 * TODO: Уточнить формат webhook у Т-Банк (openapi@tinkoff.ru)
 * TODO: Реализовать верификацию подписи, когда формат будет известен
 */

interface TBankWebhookPayload {
  /** ID счёта в Т-Банк */
  invoiceId?: string
  /** Статус: PAID, PARTIALLY_PAID, OVERDUE, CANCELLED и т.д. */
  status?: string
  /** Дата оплаты */
  paidDate?: string
  /** Сумма оплаты */
  paidAmount?: number
  /** Подпись для верификации */
  signature?: string
}

export async function POST(req: NextRequest) {
  // --- Верификация подписи ---
  // TODO: Реализовать верификацию, когда формат webhook от Т-Банк будет известен.
  // Пока используем проверку секретного токена в query-параметре как временную защиту.
  const webhookSecret = process.env.TBANK_WEBHOOK_SECRET
  if (webhookSecret) {
    const url = new URL(req.url)
    const token = url.searchParams.get("token")
    if (token !== webhookSecret) {
      console.warn("[webhook] Invalid webhook token")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  // --- Парсинг тела ---
  let payload: TBankWebhookPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    )
  }

  const { invoiceId, status, paidDate, paidAmount } = payload

  if (!invoiceId) {
    return NextResponse.json(
      { error: "invoiceId is required" },
      { status: 400 }
    )
  }

  console.log(`[webhook] Received: invoiceId=${invoiceId}, status=${status}`)

  // --- Найти счёт ---
  const invoice = await db.billingInvoice.findFirst({
    where: { tbankInvoiceId: invoiceId },
    include: {
      subscription: true,
      organization: true,
    },
  })

  if (!invoice) {
    console.warn(`[webhook] Invoice not found: tbankInvoiceId=${invoiceId}`)
    // Возвращаем 200, чтобы Т-Банк не ретраил
    return NextResponse.json({ ok: true, message: "Invoice not found, ignored" })
  }

  // --- Обновление по статусу ---
  const upperStatus = (status || "").toUpperCase()

  if (upperStatus === "PAID") {
    // Счёт оплачен: общий хелпер (продление подписки, разблокировка,
    // удаление уведомлений «оплатите счёт»)
    const result = await applyInvoicePaymentById({
      invoiceId: invoice.id,
      paidVia: "tbank_api",
      paidAmount: paidAmount ?? undefined,
      paidAt: paidDate ? new Date(paidDate) : undefined,
    })

    if (result.unblocked) {
      console.log(`[webhook] Tenant ${invoice.organizationId} unblocked after payment`)
    }
    console.log(`[webhook] Invoice ${invoice.id} marked as PAID`)
  } else if (upperStatus === "OVERDUE") {
    await db.billingInvoice.update({
      where: { id: invoice.id },
      data: { status: "overdue" },
    })
    console.log(`[webhook] Invoice ${invoice.id} marked as OVERDUE`)
  } else if (upperStatus === "CANCELLED") {
    await db.billingInvoice.update({
      where: { id: invoice.id },
      data: { status: "cancelled" },
    })
    await removeInvoiceNotifications(invoice.id, invoice.organizationId)
    console.log(`[webhook] Invoice ${invoice.id} marked as CANCELLED`)
  } else {
    console.log(`[webhook] Unhandled status "${status}" for invoice ${invoice.id}`)
  }

  // Всегда 200, чтобы webhook-система не ретраила
  return NextResponse.json({ ok: true })
}
