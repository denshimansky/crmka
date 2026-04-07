import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, pct } from "@/lib/report-helpers"

/** 10.5. Отчёт по посещениям */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const clientId = searchParams.get("clientId")

  const attWhere: any = {
    tenantId,
    lesson: { date: { gte: dateFrom, lte: dateTo } },
  }
  if (branchId) attWhere.lesson = { ...attWhere.lesson, group: { branchId } }
  if (clientId) attWhere.clientId = clientId

  const attendances = await db.attendance.findMany({
    where: attWhere,
    select: {
      id: true,
      attendanceType: { select: { code: true, name: true } },
      lesson: {
        select: {
          group: {
            select: {
              id: true,
              name: true,
              direction: { select: { name: true } },
              branch: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  const totalVisits = attendances.length

  // By type
  const byType: Record<string, { name: string; count: number }> = {}
  for (const a of attendances) {
    const code = a.attendanceType.code
    if (!byType[code]) byType[code] = { name: a.attendanceType.name, count: 0 }
    byType[code].count += 1
  }

  // By group
  const byGroup: Record<string, { name: string; direction: string; branch: string; count: number }> = {}
  for (const a of attendances) {
    const gId = a.lesson.group.id
    if (!byGroup[gId]) {
      byGroup[gId] = {
        name: a.lesson.group.name,
        direction: a.lesson.group.direction.name,
        branch: a.lesson.group.branch.name,
        count: 0,
      }
    }
    byGroup[gId].count += 1
  }

  // By branch (summary)
  const byBranch: Record<string, Record<string, number>> = {}
  for (const a of attendances) {
    const br = a.lesson.group.branch.name
    const code = a.attendanceType.code
    if (!byBranch[br]) byBranch[br] = {}
    byBranch[br][code] = (byBranch[br][code] || 0) + 1
  }

  const presentCount = byType["present"]?.count || 0
  const absentCount = byType["absent"]?.count || 0

  return NextResponse.json({
    data: {
      byType: Object.entries(byType)
        .map(([code, v]) => ({
          code,
          name: v.name,
          count: v.count,
          percent: pct(v.count, totalVisits),
        }))
        .sort((a, b) => b.count - a.count),
      byGroup: Object.values(byGroup).sort((a, b) => b.count - a.count),
      byBranch,
    },
    metadata: {
      totalVisits,
      presentCount,
      absentCount,
      attendanceRate: pct(presentCount, totalVisits),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
