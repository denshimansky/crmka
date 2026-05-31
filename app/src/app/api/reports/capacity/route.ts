import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 4.1. Свободные места в группах */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, searchParams } = result.ctx
  const { tenantId } = session
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  // Отчёт по свободным местам в группах — технические одноразовые группы
  // не имеют ёмкости в обычном смысле (maxStudents=1), их в отчёте не показываем.
  const groupWhere: any = { tenantId, deletedAt: null, isActive: true, isOneTime: false }
  if (branchId) groupWhere.branchId = branchId
  if (directionId) groupWhere.directionId = directionId

  const groups = await db.group.findMany({
    where: groupWhere,
    include: {
      direction: { select: { name: true } },
      branch: { select: { name: true } },
      room: { select: { name: true } },
      instructor: { select: { firstName: true, lastName: true } },
      enrollments: {
        where: { isActive: true, deletedAt: null },
        select: { id: true, clientId: true, wardId: true },
      },
    },
    orderBy: { name: "asc" },
  })

  // Стадия воронки считается по подопечному (Ward.salesStage): один Ward = одна сделка.
  const enrolledWardIds = [...new Set(
    groups.flatMap((g) => g.enrollments.map((e) => e.wardId).filter((id): id is string => Boolean(id)))
  )]
  const wardStages =
    enrolledWardIds.length > 0
      ? await db.ward.findMany({
          where: { id: { in: enrolledWardIds }, tenantId },
          select: { id: true, salesStage: true },
        })
      : []
  const wardStageMap = new Map(wardStages.map((w) => [w.id, w.salesStage]))

  const data = groups.map((g) => {
    const enrolled = g.enrollments.length
    const onTrial = g.enrollments.filter((e) => e.wardId && wardStageMap.get(e.wardId) === "trial_scheduled").length
    const awaitingPayment = g.enrollments.filter((e) => e.wardId && wardStageMap.get(e.wardId) === "awaiting_payment").length
    const confirmed = enrolled - onTrial - awaitingPayment
    const free = Math.max(0, g.maxStudents - enrolled)
    const percent = pct(enrolled, g.maxStudents)

    return {
      groupId: g.id,
      groupName: g.name,
      direction: g.direction.name,
      branch: g.branch.name,
      room: g.room.name,
      instructor: [g.instructor.lastName, g.instructor.firstName].filter(Boolean).join(" "),
      enrolled,
      confirmed,
      onTrial,
      awaitingPayment,
      capacity: g.maxStudents,
      free,
      fillPercent: percent,
    }
  })

  const totalEnrolled = data.reduce((s, r) => s + r.enrolled, 0)
  const totalCapacity = data.reduce((s, r) => s + r.capacity, 0)

  return NextResponse.json({
    data,
    metadata: {
      totalGroups: groups.length,
      totalEnrolled,
      totalCapacity,
      totalFree: data.reduce((s, r) => s + r.free, 0),
      avgFillPercent: pct(totalEnrolled, totalCapacity),
    },
  })
}
