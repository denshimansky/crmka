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
  const tenantId = (session.user as any).tenantId

  const client = await db.client.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!client) {
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")
  const directionId = searchParams.get("directionId")
  const wardId = searchParams.get("wardId")

  const lessonDateFilter: { gte?: Date; lte?: Date } = {}
  if (from) lessonDateFilter.gte = new Date(from)
  if (to) {
    const end = new Date(to)
    end.setUTCHours(23, 59, 59, 999)
    lessonDateFilter.lte = end
  }

  const where: any = {
    tenantId,
    clientId: id,
  }
  if (Object.keys(lessonDateFilter).length > 0) {
    where.lesson = { date: lessonDateFilter }
  }
  if (directionId) {
    where.lesson = {
      ...(where.lesson || {}),
      group: { directionId },
    }
  }
  if (wardId) {
    where.wardId = wardId
  }

  const attendances = await db.attendance.findMany({
    where,
    select: {
      id: true,
      chargeAmount: true,
      isTrial: true,
      isMakeup: true,
      markedAt: true,
      wardId: true,
      lesson: {
        select: {
          id: true,
          date: true,
          startTime: true,
          status: true,
          isMakeup: true,
          group: {
            select: {
              id: true,
              name: true,
              direction: { select: { id: true, name: true } },
              room: { select: { name: true } },
            },
          },
          instructor: { select: { firstName: true, lastName: true } },
          substituteInstructor: { select: { firstName: true, lastName: true } },
        },
      },
      attendanceType: {
        select: {
          id: true,
          name: true,
          code: true,
          chargesSubscription: true,
          countsAsRevenue: true,
        },
      },
      absenceReason: { select: { name: true } },
      subscription: {
        select: { id: true, periodYear: true, periodMonth: true },
      },
    },
    orderBy: [{ lesson: { date: "desc" } }, { lesson: { startTime: "desc" } }],
    take: 500,
  })

  // Подопечные (в Attendance нет relation ward, только wardId) — фетчим оптом
  const wardIds = Array.from(
    new Set(attendances.map((a) => a.wardId).filter((id): id is string => !!id))
  )
  const wards = wardIds.length
    ? await db.ward.findMany({
        where: { id: { in: wardIds }, tenantId },
        select: { id: true, firstName: true, lastName: true },
      })
    : []
  const wardMap = new Map(
    wards.map((w) => [
      w.id,
      {
        id: w.id,
        name: [w.lastName, w.firstName].filter(Boolean).join(" "),
      },
    ])
  )

  const result = attendances.map((a) => {
    const instructor = a.lesson.substituteInstructor || a.lesson.instructor
    return {
      id: a.id,
      lessonId: a.lesson.id,
      date: a.lesson.date.toISOString(),
      startTime: a.lesson.startTime,
      lessonStatus: a.lesson.status,
      isLessonMakeup: a.lesson.isMakeup,
      isTrial: a.isTrial,
      isMakeup: a.isMakeup,
      chargeAmount: Number(a.chargeAmount),
      markedAt: a.markedAt ? a.markedAt.toISOString() : null,
      direction: a.lesson.group.direction,
      group: { id: a.lesson.group.id, name: a.lesson.group.name },
      room: a.lesson.group.room.name,
      instructorName: [instructor.lastName, instructor.firstName]
        .filter(Boolean)
        .join(" "),
      ward: a.wardId ? wardMap.get(a.wardId) || null : null,
      attendanceType: a.attendanceType,
      absenceReason: a.absenceReason?.name || null,
      subscription: a.subscription,
    }
  })

  return NextResponse.json(result)
}
