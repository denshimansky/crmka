import { NextRequest } from "next/server"
import { runCron } from "@/lib/cron/heartbeat"
import { generateBillingInvoices } from "@/lib/cron/billing-generate-invoices"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/billing-generate-invoices
//
// Автовыставление SaaS-счетов за следующий месяц (с 20-го числа ежедневно).
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  return runCron("billing-generate-invoices", req, () => generateBillingInvoices())
}
