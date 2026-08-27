import { NextRequest } from "next/server"
import { runCron } from "@/lib/cron/heartbeat"
import { closeFinishedCalendarSubscriptions } from "@/lib/cron/close-finished-calendar-subscriptions"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/close-finished-calendar-subscriptions
//
// Ежедневно в 03:00 МСК закрывает календарные абонементы за прошедшие месяцы,
// у которых нет долга и все занятия израсходованы (100%-списания плюс
// финальные несписывающие — Уваж. пропуск/Перерасчёт).
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  return runCron("close-finished-calendar-subscriptions", req, () =>
    closeFinishedCalendarSubscriptions(),
  )
}
