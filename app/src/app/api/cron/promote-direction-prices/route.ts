import { NextRequest, NextResponse } from "next/server"
import { promoteDirectionPrices } from "@/lib/cron/promote-direction-prices"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/promote-direction-prices
//
// Ежедневно в 00:00 UTC (= 03:00 МСК) переносит наступившие версии цены
// направления (DirectionPrice, effectiveFrom <= сегодня) в базовые поля
// направления и помечает их applied (баг #88). Идемпотентно.
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

  const result = await promoteDirectionPrices()
  return NextResponse.json({ ok: true, ...result })
}
