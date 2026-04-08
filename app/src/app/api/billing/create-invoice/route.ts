import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  getTBankClient,
  buildSaasInvoiceParams,
  TBankApiError,
} from "@/lib/tbank"

/**
 * POST /api/billing/create-invoice
 *
 * Создаёт счёт в Т-Банк API и сохраняет в BillingInvoice.
 * Доступ: owner, manager.
 *
 * Body (опционально):
 *   { billingPeriodMonths?: number }  — переопределить период из подписки
 *
 * Ответ:
 *   { invoice, tbankInvoiceId?, paymentUrl? }
 */
export async function POST(req: NextRequest) {
  // --- Авторизация ---
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tenantId = (session.user as any).tenantId
  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json(
      { error: "Доступ только для владельца и управляющего" },
      { status: 403 }
    )
  }

  // --- Подписка ---
  const subscription = await db.billingSubscription.findFirst({
    where: { organizationId: tenantId, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  })

  if (!subscription) {
    return NextResponse.json(
      { error: "Активная подписка не найдена" },
      { status: 404 }
    )
  }

  // --- Организация ---
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, legalName: true, inn: true, email: true },
  })

  if (!org) {
    return NextResponse.json(
      { error: "Организация не найдена" },
      { status: 404 }
    )
  }

  // --- Параметры ---
  let body: { billingPeriodMonths?: number } = {}
  try {
    body = await req.json()
  } catch {
    // пустое тело — используем данные из подписки
  }

  const periodMonths = body.billingPeriodMonths || subscription.billingPeriodMonths
  const pricePerBranch = Number(subscription.plan.pricePerBranch)
  const branchCount = subscription.branchCount
  const amount = pricePerBranch * branchCount * periodMonths

  // --- Номер счёта ---
  const lastInvoice = await db.billingInvoice.findFirst({
    orderBy: { createdAt: "desc" },
    select: { number: true },
  })
  const lastNumber = lastInvoice?.number
    ? parseInt(lastInvoice.number.replace(/\D/g, ""), 10)
    : 0
  const invoiceNumber = String(lastNumber + 1).padStart(6, "0")

  // --- Даты ---
  const now = new Date()
  const periodStart = subscription.nextPaymentDate
    ? new Date(subscription.nextPaymentDate)
    : now

  const periodEnd = new Date(periodStart)
  periodEnd.setMonth(periodEnd.getMonth() + periodMonths)

  const dueDate = new Date(periodStart)
  dueDate.setDate(dueDate.getDate() + 5) // 5 дней на оплату

  const formatDate = (d: Date) => d.toISOString().split("T")[0]

  // --- Создаём запись в БД (pending) ---
  const invoice = await db.billingInvoice.create({
    data: {
      subscriptionId: subscription.id,
      organizationId: tenantId,
      number: invoiceNumber,
      amount,
      periodMonths,
      branchCount,
      status: "pending",
      periodStart,
      periodEnd,
      dueDate,
      comment: `SaaS «Умная CRM», ${branchCount} фил. × ${periodMonths} мес.`,
    },
  })

  // --- Отправляем в Т-Банк (если токен есть) ---
  let tbankInvoiceId: string | null = null
  let paymentUrl: string | null = null
  let tbankError: string | null = null

  if (process.env.TBANK_API_TOKEN) {
    try {
      const client = getTBankClient()
      const params = buildSaasInvoiceParams({
        invoiceNumber,
        amount,
        branchCount,
        periodMonths,
        dueDate: formatDate(dueDate),
        payer: {
          name: org.legalName || org.name,
          inn: org.inn || "",
        },
        payerEmail: org.email || undefined,
      })

      const result = await client.createInvoice(params)
      tbankInvoiceId = result.invoiceId || null
      paymentUrl = result.paymentUrl

      // Обновляем запись
      await db.billingInvoice.update({
        where: { id: invoice.id },
        data: {
          tbankInvoiceId,
          paymentUrl,
          paidVia: "tbank_api",
        },
      })
    } catch (err) {
      if (err instanceof TBankApiError) {
        tbankError = `T-Bank API: ${err.message} (${err.statusCode})`
        console.error("[create-invoice] TBank API error:", err.statusCode, err.responseBody)
      } else {
        tbankError = `T-Bank API: ${(err as Error).message}`
        console.error("[create-invoice] TBank error:", err)
      }
      // Счёт создан в БД — можно оплатить вручную (fallback)
    }
  } else {
    console.warn("[create-invoice] TBANK_API_TOKEN не задан — счёт создан только в БД")
  }

  // --- Ответ ---
  const updatedInvoice = await db.billingInvoice.findUnique({
    where: { id: invoice.id },
  })

  return NextResponse.json({
    invoice: updatedInvoice,
    tbankInvoiceId,
    paymentUrl,
    ...(tbankError ? { tbankError } : {}),
  })
}
