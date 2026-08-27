import { NextRequest } from "next/server"
import { runCron } from "@/lib/cron/heartbeat"
import { closeExpiredPackages } from "@/lib/cron/close-expired-packages"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/close-expired-packages
//
// Раз в сутки закрывает все пакетные абонементы с истёкшим expiresAt.
// Авторизация: header Authorization: Bearer ${CRON_SECRET}. Пульс + перезапуск
// при пропуске — через runCron (сторож /api/cron/self-check).
export async function POST(req: NextRequest) {
  return runCron("close-expired-packages", req, () => closeExpiredPackages())
}
