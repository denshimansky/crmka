import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { generateTasksForTenant } from "@/lib/tasks/generate-tasks"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/generate-tasks
//
// Раз в сутки (GitHub Actions cron) генерирует автозадачи по 6 триггерам для всех
// тенантов: дата следующей связи (включая просроченные), обещанная оплата, ДР,
// неотмеченные занятия, долгое ожидание оплаты, неуточнённый «Не был».
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

  return NextResponse.json({
    ok: errors.length === 0,
    tenants: orgs.length,
    created,
    ...(errors.length > 0 ? { errors } : {}),
  })
}
