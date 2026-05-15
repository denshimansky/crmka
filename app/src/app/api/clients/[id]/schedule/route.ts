import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  // Verify client exists and belongs to tenant
  const client = await db.client.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!client) {
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  }

  // Get active enrollments for this client
  const enrollments = await db.groupEnrollment.findMany({
    where: {
      clientId: id,
      tenantId,
      isActive: true,
      deletedAt: null,
    },
    select: { groupId: true },
  })

  // Get today's date at midnight for filtering
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const groupIds = enrollments.map((e) => e.groupId)

  // Fetch upcoming lessons for enrolled groups
  const lessons = groupIds.length
    ? await db.lesson.findMany({
        where: {
          tenantId,
          groupId: { in: groupIds },
          date: { gte: today },
          status: "scheduled",
        },
        select: {
          id: true,
          date: true,
          startTime: true,
          durationMinutes: true,
          status: true,
          group: {
            select: {
              id: true,
              name: true,
              direction: { select: { name: true } },
              room: { select: { name: true } },
            },
          },
          instructor: {
            select: { firstName: true, lastName: true },
          },
          substituteInstructor: {
            select: { firstName: true, lastName: true },
          },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        take: 50,
      })
    : []

  // Запланированные пробные у этого лида/клиента
  const trials = await db.trialLesson.findMany({
    where: {
      tenantId,
      clientId: id,
      status: "scheduled",
      scheduledDate: { gte: today },
    },
    select: {
      id: true,
      scheduledDate: true,
      lesson: {
        select: { id: true, startTime: true, durationMinutes: true },
      },
      group: {
        select: {
          name: true,
          direction: { select: { name: true } },
          room: { select: { name: true } },
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { scheduledDate: "asc" },
    take: 50,
  })

  const regularResult = lessons.map((l) => {
    const instructor = l.substituteInstructor || l.instructor
    return {
      id: l.id,
      date: l.date.toISOString(),
      startTime: l.startTime,
      durationMinutes: l.durationMinutes,
      groupName: l.group.name,
      directionName: l.group.direction.name,
      roomName: l.group.room.name,
      instructorName: [instructor.lastName, instructor.firstName]
        .filter(Boolean)
        .join(" "),
      isTrial: false,
    }
  })

  const trialResult = trials.map((t) => ({
    id: t.lesson?.id || t.id,
    date: t.scheduledDate.toISOString(),
    startTime: t.lesson?.startTime || "—",
    durationMinutes: t.lesson?.durationMinutes || 0,
    groupName: t.group.name,
    directionName: t.group.direction.name,
    roomName: t.group.room.name,
    instructorName: [t.group.instructor.lastName, t.group.instructor.firstName]
      .filter(Boolean)
      .join(" "),
    isTrial: true,
  }))

  // Объединяем и сортируем по дате + времени
  const combined = [...regularResult, ...trialResult].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return a.startTime.localeCompare(b.startTime)
  })

  return NextResponse.json(combined)
}
