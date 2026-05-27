import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  branchId: z.string().uuid("Некорректный филиал"),
  roomId: z.string().uuid("Некорректный кабинет"),
  directionId: z.string().uuid("Некорректное направление"),
  instructorId: z.string().uuid("Некорректный педагог"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате YYYY-MM-DD"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Время в формате HH:MM"),
  durationMinutes: z.number().int().min(1).max(600).default(60),
})

/**
 * POST /api/standalone-lessons
 *
 * Создаёт разовое занятие вне расписания группы: за кулисами появляется
 * техническая Group(isOneTime=true), к которой привязан единственный Lesson.
 * Группа в UI не показывается (фильтр isOneTime=false везде, где выводятся
 * группы или строятся отчёты по группам).
 *
 * Доступно только owner / manager / admin.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager" && role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const tenantId = session.user.tenantId

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверки целостности связей.
  const [branch, room, direction, instructor] = await Promise.all([
    db.branch.findFirst({ where: { id: data.branchId, tenantId, deletedAt: null } }),
    db.room.findFirst({ where: { id: data.roomId, tenantId, deletedAt: null } }),
    db.direction.findFirst({ where: { id: data.directionId, tenantId, deletedAt: null } }),
    db.employee.findFirst({ where: { id: data.instructorId, tenantId, deletedAt: null } }),
  ])
  if (!branch) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })
  if (!room) return NextResponse.json({ error: "Кабинет не найден" }, { status: 404 })
  if (room.branchId !== data.branchId) {
    return NextResponse.json({ error: "Кабинет не относится к выбранному филиалу" }, { status: 400 })
  }
  if (!direction) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })
  if (!instructor) return NextResponse.json({ error: "Педагог не найден" }, { status: 404 })

  const dateObj = new Date(data.date)
  if (isNaN(dateObj.getTime())) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 })
  }

  // Транзакция: техническая Group + Lesson.
  const lesson = await db.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: {
        tenantId,
        name: `Разовое ${data.date} ${data.startTime}`,
        directionId: data.directionId,
        branchId: data.branchId,
        roomId: data.roomId,
        instructorId: data.instructorId,
        maxStudents: 1,
        isActive: true,
        isOneTime: true,
      },
    })
    return tx.lesson.create({
      data: {
        tenantId,
        groupId: group.id,
        date: dateObj,
        startTime: data.startTime,
        durationMinutes: data.durationMinutes,
        instructorId: data.instructorId,
        status: "scheduled",
      },
      include: {
        group: {
          include: {
            branch: { select: { id: true, name: true } },
            direction: { select: { id: true, name: true } },
            room: { select: { id: true, name: true } },
          },
        },
        instructor: { select: { id: true, firstName: true, lastName: true } },
      },
    })
  })

  return NextResponse.json(lesson, { status: 201 })
}
