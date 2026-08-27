import { NextRequest } from "next/server"
import { runCron } from "@/lib/cron/heartbeat"
import { notifyExpiringPackages } from "@/lib/cron/notify-expiring-packages"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/notify-expiring-packages
//
// Раз в сутки: уведомления в колокольчик + задачи админам о скорых истечениях
// пакетов (с несгоревшими занятиями). Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  return runCron("notify-expiring-packages", req, () => notifyExpiringPackages())
}
