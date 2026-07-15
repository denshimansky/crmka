import { NextRequest, NextResponse } from "next/server"
import { checkBillingPayments } from "@/lib/cron/billing-check-payments"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/billing-check-payments
//
// Сверка оплат SaaS-счетов по выписке Т-Банк (каждые 2 часа днём).
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

  const result = await checkBillingPayments()
  return NextResponse.json({ ok: true, ...result })
}
