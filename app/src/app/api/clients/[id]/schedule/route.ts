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

  if (enrollments.length === 0) {
    return NextResponse.json([])
  }

  const groupIds = enrollments.map((e) => e.groupId)

  // Get today's date at midnight for filtering
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Fetch upcoming lessons for enrolled groups
  const lessons = await db.lesson.findMany({
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

  const result = lessons.map((l) => {
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
    }
  })

  return NextResponse.json(result)
}
