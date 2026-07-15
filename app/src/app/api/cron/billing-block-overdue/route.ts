import { NextRequest, NextResponse } from "next/server"
import { blockOverdueBilling } from "@/lib/cron/billing-block-overdue"
import { checkBillingPayments } from "@/lib/cron/billing-check-payments"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/billing-block-overdue
//
// 1-го числа: сперва best-effort сверка свежей выписки (платежи за вечер
// 30/31-го), затем блокировка организаций с неоплаченными счетами.
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET не сконфигурирован" }, { status: 500 })
  }
  const auth = req.headers.get("authorization") || ""
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Свежая выписка перед блокировкой — не блокировать уже оплативших
  let paymentsCheckedFirst: unknown = null
  try {
    paymentsCheckedFirst = await checkBillingPayments()
  } catch (e) {
    paymentsCheckedFirst = { error: (e as Error).message }
  }

  const result = await blockOverdueBilling()
  return NextResponse.json({ ok: true, ...result, paymentsCheckedFirst })
}
