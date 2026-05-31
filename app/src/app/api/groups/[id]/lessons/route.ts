import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/groups/{id}/lessons?from=YYYY-MM-DD
// Возвращает неотменённые занятия группы начиная с указанной даты (по умолчанию — сегодня).
// Используется в формах записи на пробное, чтобы предлагать только реальные даты группы
// и не получать «У группы нет занятия на эту дату» при сабмите.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId
  const url = new URL(req.url)
  const fromParam = url.searchParams.get("from")
  const from = fromParam ? new Date(fromParam) : new Date()
  from.setHours(0, 0, 0, 0)

  const group = await db.group.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!group) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

  const lessons = await db.lesson.findMany({
    where: {
      tenantId,
      groupId: id,
      status: { not: "cancelled" },
      date: { gte: from },
    },
    select: { id: true, date: true, startTime: true, durationMinutes: true },
    orderBy: { date: "asc" },
    take: 60,
  })

  return NextResponse.json(lessons)
}
