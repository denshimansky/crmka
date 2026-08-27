import { NextRequest } from "next/server"
import { runCron } from "@/lib/cron/heartbeat"
import { blockOverdueBilling } from "@/lib/cron/billing-block-overdue"
import { checkBillingPayments } from "@/lib/cron/billing-check-payments"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/billing-block-overdue
//
// Сперва best-effort сверка свежей выписки (ночные оплаты), затем блокировка
// организаций с неоплаченными счетами — чтобы не заблокировать уже оплативших.
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  return runCron("billing-block-overdue", req, async () => {
    // Свежая выписка перед блокировкой — не блокировать уже оплативших.
    let paymentsCheckedFirst: unknown = null
    try {
      paymentsCheckedFirst = await checkBillingPayments()
    } catch (e) {
      paymentsCheckedFirst = { error: (e as Error).message }
    }

    const result = await blockOverdueBilling()
    return { ...result, paymentsCheckedFirst }
  })
}
