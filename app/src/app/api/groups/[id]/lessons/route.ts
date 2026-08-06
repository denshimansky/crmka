import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/groups/{id}/lessons?from=YYYY-MM-DD&includePast=1
// Возвращает неотменённые занятия группы начиная с указанной даты (по умолчанию — сегодня).
// Используется в формах записи на пробное, чтобы предлагать только реальные даты группы
// и не получать «У группы нет занятия на эту дату» при сабмите.
// includePast=1 — добавляет последние 90 дней к выдаче (баг #51: разрешить пробное
// задним числом, если ребёнок реально пришёл).
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
  const toParam = url.searchParams.get("to")
  const includePast = url.searchParams.get("includePast") === "1"
  const from = fromParam ? new Date(fromParam) : new Date()
  from.setHours(0, 0, 0, 0)
  if (includePast && !fromParam) {
    from.setDate(from.getDate() - 90)
  }
  // to — верхняя граница окна (напр. expiresAt пакета) для пикера занятий.
  const to = toParam ? new Date(toParam) : null
  if (to) to.setHours(23, 59, 59, 999)

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
      date: { gte: from, ...(to ? { lte: to } : {}) },
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      durationMinutes: true,
      instructor: { select: { firstName: true, lastName: true } },
      substituteInstructor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { date: "asc" },
    // Окно пакета (validDays до 365) при 5 занятиях/нед ≈ 260 — поднимаем кап при to.
    take: to ? 400 : includePast ? 200 : 60,
  })

  // Добавляем эффективного инструктора и isPast, сохраняя прежние поля
  // (id/date/startTime/durationMinutes) — потребители пробных форм не ломаются.
  const todayFloor = new Date()
  todayFloor.setHours(0, 0, 0, 0)
  const result = lessons.map((l) => {
    const eff = l.substituteInstructor ?? l.instructor
    return {
      id: l.id,
      date: l.date,
      startTime: l.startTime,
      durationMinutes: l.durationMinutes,
      instructorName: [eff?.lastName, eff?.firstName].filter(Boolean).join(" ") || null,
      isSubstitute: !!l.substituteInstructor,
      isPast: l.date < todayFloor,
    }
  })

  return NextResponse.json(result)
}
