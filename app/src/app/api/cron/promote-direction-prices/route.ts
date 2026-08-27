import { NextRequest } from "next/server"
import { runCron } from "@/lib/cron/heartbeat"
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
  return runCron("promote-direction-prices", req, () => promoteDirectionPrices())
}
