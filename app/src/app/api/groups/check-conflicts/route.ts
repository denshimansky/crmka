import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/session"
import { findRoomScheduleConflicts } from "@/lib/schedule/group-conflicts"

const bodySchema = z.object({
  roomId: z.string().min(1, "Выберите кабинет"),
  excludeGroupId: z.string().optional(),
  templates: z
    .array(
      z.object({
        dayOfWeek: z.number().min(0).max(6),
        startTime: z.string().regex(/^\d{2}:\d{2}$/, "Формат: HH:MM"),
        durationMinutes: z.number().min(1),
      }),
    )
    .min(1, "Добавьте хотя бы один день расписания"),
})

// POST /api/groups/check-conflicts — проверка пересечений шаблонов с
// существующими группами в том же кабинете. Используется перед созданием
// или сохранением группы, чтобы показать предупреждение.
export async function POST(request: NextRequest) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const body = await request.json()
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const conflicts = await findRoomScheduleConflicts({
    tenantId,
    roomId: parsed.data.roomId,
    templates: parsed.data.templates,
    excludeGroupId: parsed.data.excludeGroupId,
  })

  return NextResponse.json({ conflicts })
}
