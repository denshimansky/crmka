import { NextRequest, NextResponse } from "next/server"
import { closeExpiredPackages } from "@/lib/cron/close-expired-packages"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/close-expired-packages
//
// Раз в сутки закрывает все пакетные абонементы с истёкшим expiresAt.
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

  const result = await closeExpiredPackages()
  return NextResponse.json({ ok: true, ...result })
}
