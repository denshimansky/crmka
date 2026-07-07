import { NextRequest, NextResponse } from "next/server"
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
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET не сконфигурирован" }, { status: 500 })
  }
  const auth = req.headers.get("authorization") || ""
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await closeFinishedCalendarSubscriptions()
  return NextResponse.json({ ok: true, ...result })
}
