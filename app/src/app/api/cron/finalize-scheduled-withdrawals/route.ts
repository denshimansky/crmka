import { NextRequest, NextResponse } from "next/server"
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
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET не сконфигурирован" }, { status: 500 })
  }
  const auth = req.headers.get("authorization") || ""
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await finalizeScheduledWithdrawals()
  return NextResponse.json({ ok: true, ...result })
}
