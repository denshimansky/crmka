import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/clients/[id]/makeup-eligible-lessons?wardId=...&date=YYYY-MM-DD&excludeLessonId=...
 *
 * Возвращает занятия выбранного подопечного на указанную дату, которые могут
 * быть отработаны на «текущем» занятии:
 * - Прошлые: уже есть Attendance ребёнка на этой дате с типом ≠ present (любая
 *   отметка кроме явки — прогул, перерасчёт и т.д.).
 * - Будущие/сегодня: занятия групп, в которых ребёнок имеет активный enrollment
 *   и для которых Attendance ещё нет.
 *
 * Исключаются занятия, для которых уже создана отработка (Attendance с
 * makeupOfLessonId = lesson.id, wardId = выбранный).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: clientId } = await params
  const tenantId = session.user.tenantId

  const url = new URL(req.url)
  const wardId = url.searchParams.get("wardId")
  const dateStr = url.searchParams.get("date")
  const excludeLessonId = url.searchParams.get("excludeLessonId") || null

  if (!wardId || !/^[0-9a-f-]{36}$/i.test(wardId)) {
    return NextResponse.json({ error: "Не указан подопечный" }, { status: 400 })
  }
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "Не указана дата" }, { status: 400 })
  }

  const ward = await db.ward.findFirst({
    where: { id: wardId, clientId, tenantId },
    select: { id: true },
  })
  if (!ward) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })

  const date = new Date(dateStr + "T00:00:00")
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(23, 59, 59, 999)

  // Уже отработанные занятия (чтобы исключить из списка)
  const alreadyMadeUp = await db.attendance.findMany({
    where: {
      tenantId,
      wardId,
      makeupOfLessonId: { not: null },
    },
    select: { makeupOfLessonId: true },
  })
  const madeUpLessonIds = new Set(
    alreadyMadeUp.map((a) => a.makeupOfLessonId).filter((id): id is string => !!id),
  )

  // Прошлые/текущие: Attendance != present за указанную дату
  const pastAttendances = await db.attendance.findMany({
    where: {
      tenantId,
      wardId,
      lesson: { date: { gte: dayStart, lte: dayEnd } },
      attendanceType: { code: { not: "present" } },
    },
    include: {
      attendanceType: { select: { code: true, name: true } },
      lesson: {
        include: {
          group: {
            include: {
              direction: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
          instructor: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  })

  // Будущие/сегодня: запись на группу есть, но Attendance ещё не отмечен.
  const enrollments = await db.groupEnrollment.findMany({
    where: {
      tenantId,
      wardId,
      isActive: true,
      deletedAt: null,
      enrolledAt: { lte: dayEnd },
      OR: [{ withdrawnAt: null }, { withdrawnAt: { gte: dayStart } }],
    },
    select: { groupId: true },
  })
  const groupIds = enrollments.map((e) => e.groupId)
  const futureLessons = groupIds.length
    ? await db.lesson.findMany({
        where: {
          tenantId,
          groupId: { in: groupIds },
          date: { gte: dayStart, lte: dayEnd },
          status: { not: "cancelled" },
        },
        include: {
          group: {
            include: {
              direction: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
          instructor: { select: { id: true, firstName: true, lastName: true } },
          attendances: {
            where: { wardId },
            select: { id: true },
          },
        },
      })
    : []

  function fmtInstructor(i: { firstName: string | null; lastName: string }): string {
    return `${i.lastName} ${i.firstName?.[0] ? i.firstName[0] + "." : ""}`.trim()
  }

  type LessonItem = {
    lessonId: string
    date: string
    startTime: string
    durationMinutes: number
    groupName: string
    directionName: string
    branchName: string | null
    instructorName: string
    attendanceCode: string | null
    attendanceLabel: string | null
    kind: "past" | "future"
  }

  const items: LessonItem[] = []

  for (const a of pastAttendances) {
    if (excludeLessonId && a.lesson.id === excludeLessonId) continue
    if (madeUpLessonIds.has(a.lesson.id)) continue
    items.push({
      lessonId: a.lesson.id,
      date: a.lesson.date.toISOString().slice(0, 10),
      startTime: a.lesson.startTime,
      durationMinutes: a.lesson.durationMinutes,
      groupName: a.lesson.group.name,
      directionName: a.lesson.group.direction.name,
      branchName: a.lesson.group.branch?.name ?? null,
      instructorName: fmtInstructor(a.lesson.instructor),
      attendanceCode: a.attendanceType.code,
      attendanceLabel: a.attendanceType.name,
      kind: "past",
    })
  }

  for (const l of futureLessons) {
    if (excludeLessonId && l.id === excludeLessonId) continue
    if (madeUpLessonIds.has(l.id)) continue
    if (l.attendances.length > 0) continue // уже отмечен — попадёт в past выше, если != present
    items.push({
      lessonId: l.id,
      date: l.date.toISOString().slice(0, 10),
      startTime: l.startTime,
      durationMinutes: l.durationMinutes,
      groupName: l.group.name,
      directionName: l.group.direction.name,
      branchName: l.group.branch?.name ?? null,
      instructorName: fmtInstructor(l.instructor),
      attendanceCode: null,
      attendanceLabel: null,
      kind: "future",
    })
  }

  items.sort((a, b) => a.startTime.localeCompare(b.startTime))

  return NextResponse.json(items)
}
