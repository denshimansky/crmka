import { NextRequest, NextResponse } from "next/server"
import { closeUnpaidSubscriptions } from "@/lib/cron/close-unpaid-subscriptions"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/close-unpaid-subscriptions
//
// Раз в сутки закрывает все неоплаченные абонементы без посещений у тенантов,
// у которых задано Organization.unpaidSubscriptionAutoCloseDays.
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

  const result = await closeUnpaidSubscriptions()
  return NextResponse.json({ ok: true, ...result })
}
