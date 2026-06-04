import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import {
  generateGroupLessons,
  getGenerationRange,
} from "@/lib/schedule/generate-group-lessons"

// POST /api/groups/[id]/regenerate
// Перегенерирует расписание группы на основе её текущих startDate/endDate и
// шаблонов. Поведение — additive: ничего не удаляем, только добавляем
// недостающие занятия по шаблонам. Это безопасно при backdating startDate
// (можно «довести» прошлые занятия для отметки задним числом) и при сдвиге
// endDate вперёд.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const session = await getSession()
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }
  const tenantId = session.user.tenantId

  const group = await db.group.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: { templates: { where: { effectiveTo: null } } },
  })
  if (!group) {
    return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })
  }
  if (group.templates.length === 0) {
    return NextResponse.json(
      { error: "У группы нет шаблонов расписания — добавьте их и повторите" },
      { status: 400 },
    )
  }

  const { rangeStart, rangeEnd } = getGenerationRange(group.startDate, group.endDate)

  const result = await generateGroupLessons({
    tenantId,
    groupId: group.id,
    instructorId: group.instructorId,
    templates: group.templates.map((t) => ({
      dayOfWeek: t.dayOfWeek,
      startTime: t.startTime,
      durationMinutes: t.durationMinutes,
    })),
    rangeStart,
    rangeEnd,
  })

  return NextResponse.json({
    created: result.created,
    skipped: result.skippedNonWorking,
    skippedDates: result.skippedDates,
    rangeStart: rangeStart.toISOString().slice(0, 10),
    rangeEnd: rangeEnd.toISOString().slice(0, 10),
  })
}
