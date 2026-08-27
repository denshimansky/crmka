import { NextRequest } from "next/server"
import { runCron } from "@/lib/cron/heartbeat"
import { closeUnpaidSubscriptions } from "@/lib/cron/close-unpaid-subscriptions"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/close-unpaid-subscriptions
//
// Раз в сутки закрывает все неоплаченные абонементы без посещений у тенантов,
// у которых задано Organization.unpaidSubscriptionAutoCloseDays.
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  return runCron("close-unpaid-subscriptions", req, () => closeUnpaidSubscriptions())
}
