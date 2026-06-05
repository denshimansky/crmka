import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { branchScopeFromSession, scopeBranch } from "@/lib/branch-scope"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { LoadTable, type LoadData, type LoadAgg, type RoomLoad } from "./load-table"

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export default async function CenterLoadReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  const sp = await searchParams
  const { year, month } = getMonthFromParams(sp)

  const dateFrom = new Date(Date.UTC(year, month - 1, 1))
  const dateTo = new Date(Date.UTC(year, month, 0, 23, 59, 59))

  // Период в днях — для расчёта максимум часов
  const daysBetween =
    Math.floor((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1

  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
    select: {
      id: true,
      name: true,
      workingHoursStart: true,
      workingHoursEnd: true,
      workingDays: true,
      rooms: {
        where: { deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { name: "asc" },
  })

  const lessonWhere = {
    tenantId,
    date: { gte: dateFrom, lte: dateTo },
    status: { not: "cancelled" as const },
    ...(scope.mode === "limited"
      ? { group: { branchId: { in: scope.branchIds } } }
      : {}),
  }

  const lessons = await db.lesson.findMany({
    where: lessonWhere,
    select: {
      id: true,
      durationMinutes: true,
      group: { select: { branchId: true, roomId: true } },
      attendances: { select: { id: true } },
    },
  })

  // Только занятия с ≥1 отмеченным учеником.
  const filled = lessons.filter((l) => l.attendances.length > 0)

  // Часы по (branchId, roomId)
  const roomHours = new Map<string, number>()
  for (const l of filled) {
    const key = `${l.group.branchId}|${l.group.roomId}`
    roomHours.set(key, (roomHours.get(key) || 0) + l.durationMinutes / 60)
  }

  // Строим данные с иерархией Филиал → Кабинет
  const branchesData: LoadData["branches"] = branches.map((b) => {
    const start = b.workingHoursStart ? parseFloat(b.workingHoursStart.split(":")[0]) : 9
    const end = b.workingHoursEnd ? parseFloat(b.workingHoursEnd.split(":")[0]) : 21
    const hoursPerDay = Math.max(0, end - start)
    const workingDaysCount = Array.isArray(b.workingDays)
      ? (b.workingDays as number[]).length
      : 6
    const workingDaysRatio = workingDaysCount / 7
    const maxPerRoom = round1(hoursPerDay * daysBetween * workingDaysRatio)

    const rooms: RoomLoad[] = b.rooms.map((r) => {
      const actual = round1(roomHours.get(`${b.id}|${r.id}`) || 0)
      return {
        id: r.id,
        name: r.name,
        maxHours: maxPerRoom,
        actualHours: actual,
        percent: pct(actual, maxPerRoom),
      }
    })

    const branchMax = round1(maxPerRoom * (rooms.length || 0))
    const branchActual = round1(rooms.reduce((s, r) => s + r.actualHours, 0))

    return {
      id: b.id,
      name: b.name,
      agg: {
        maxHours: branchMax,
        actualHours: branchActual,
        percent: pct(branchActual, branchMax),
      },
      rooms,
    }
  })

  const total: LoadAgg = {
    maxHours: round1(branchesData.reduce((s, b) => s + b.agg.maxHours, 0)),
    actualHours: round1(branchesData.reduce((s, b) => s + b.agg.actualHours, 0)),
    percent: 0,
  }
  total.percent = pct(total.actualHours, total.maxHours)

  const data: LoadData = { total, branches: branchesData }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Загруженность центра</h1>
            <PageHelp pageKey="reports/schedule/load" />
          </div>
          <p className="text-sm text-muted-foreground">
            Фактические часы занятий с явками относительно рабочих часов филиала и
            кабинетов
          </p>
        </div>
        <MonthPicker />
      </div>

      {branchesData.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет филиалов
          </CardContent>
        </Card>
      ) : (
        <LoadTable data={data} />
      )}
    </div>
  )
}
