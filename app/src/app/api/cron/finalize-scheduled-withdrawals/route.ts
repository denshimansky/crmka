import { NextRequest } from "next/server"
import { runCron } from "@/lib/cron/heartbeat"
import { finalizeScheduledWithdrawals } from "@/lib/cron/finalize-scheduled-withdrawals"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/finalize-scheduled-withdrawals
//
// Раз в сутки (GitHub Actions cron) находит абонементы с наступившей датой
// отложенного отчисления (scheduledWithdrawalDate < сегодня) и проводит финальную
// денежную сверку: возврат остатка за непосещённые занятия на баланс, перевод в
// withdrawn. См. lib/cron/finalize-scheduled-withdrawals.ts.
//
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  return runCron("finalize-scheduled-withdrawals", req, () => finalizeScheduledWithdrawals())
}
