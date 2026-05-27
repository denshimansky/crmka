import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { logAudit } from "@/lib/audit"
import { MANAGED_TRIGGERS, type TriggerSetting } from "@/lib/tasks/trigger-settings"
import { z } from "zod"

const itemSchema = z.object({
  trigger: z.enum([
    "contact_date",
    "promised_payment",
    "birthday",
    "unmarked_lesson",
    "payment_due",
    "trial_reminder",
    "absence",
  ]),
  enabled: z.boolean(),
  startDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
})

const schema = z.object({
  settings: z.array(itemSchema),
})

/**
 * PATCH /api/organization/task-triggers — Ф6.2
 * Сохраняет настройки автотриггеров задач (включён/выключен + «с N числа»).
 * Доступно владельцу и управляющему.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json(
      { error: "Только владелец или управляющий может менять настройки задач" },
      { status: 403 },
    )
  }

  const tenantId = session.user.tenantId
  const employeeId = session.user.employeeId

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  // Нормализуем: оставляем только разрешённые триггеры и убираем дубли
  // (берём последнее значение по каждому триггеру).
  const map = new Map<string, TriggerSetting>()
  for (const item of parsed.data.settings) {
    if (!MANAGED_TRIGGERS.includes(item.trigger as (typeof MANAGED_TRIGGERS)[number])) continue
    map.set(item.trigger, {
      trigger: item.trigger,
      enabled: item.enabled,
      startDayOfMonth: item.startDayOfMonth ?? null,
    })
  }
  const normalized: TriggerSetting[] = Array.from(map.values())

  await db.organization.update({
    where: { id: tenantId },
    data: { taskTriggerSettings: normalized as unknown as object },
  })

  logAudit({
    tenantId,
    employeeId,
    action: "update",
    entityType: "Organization",
    entityId: tenantId,
    changes: { taskTriggerSettings: { new: normalized } },
    req,
  })

  return NextResponse.json({ settings: normalized })
}
