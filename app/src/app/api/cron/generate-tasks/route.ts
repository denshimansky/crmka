import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { runCron } from "@/lib/cron/heartbeat"
import { generateTasksForTenant } from "@/lib/tasks/generate-tasks"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/generate-tasks
//
// Раз в сутки генерирует автозадачи по 7 триггерам для всех тенантов: дата
// следующей связи (включая просроченные), обещанная оплата, ДР, неотмеченные
// занятия, ожидание оплаты (со следующего дня), неуточнённый «Не был» (со
// следующего дня), за день до 1-го платного.
//
// Авторизация: header Authorization: Bearer ${CRON_SECRET}. Пульс + перезапуск
// при пропуске — через runCron (сторож /api/cron/self-check).
export async function POST(req: NextRequest) {
  return runCron("generate-tasks", req, async () => {
    const orgs = await db.organization.findMany({ select: { id: true } })

    let created = 0
    const errors: { tenantId: string; error: string }[] = []

    // Тенанты обрабатываем последовательно и изолированно: сбой одного не должен
    // прерывать генерацию для остальных.
    for (const o of orgs) {
      try {
        created += await generateTasksForTenant(o.id)
      } catch (e) {
        errors.push({ tenantId: o.id, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return {
      ok: errors.length === 0,
      tenants: orgs.length,
      created,
      ...(errors.length > 0 ? { errors } : {}),
    }
  })
}
