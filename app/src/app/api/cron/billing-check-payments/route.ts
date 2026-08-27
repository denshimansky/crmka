import { NextRequest } from "next/server"
import { runCron } from "@/lib/cron/heartbeat"
import { checkBillingPayments } from "@/lib/cron/billing-check-payments"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/billing-check-payments
//
// Сверка оплат SaaS-счетов по выписке Т-Банк (внутридневной, каждые 2 часа).
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  return runCron("billing-check-payments", req, () => checkBillingPayments())
}
