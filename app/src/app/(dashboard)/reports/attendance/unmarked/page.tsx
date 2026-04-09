import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, AlertCircle } from "lucide-react"
import Link from "next/link"
import { ReportExport } from "@/components/report-export"

function formatDate(d: string): string {
  const [y, m, day] = d.split("-")
  return `${day}.${m}.${y}`
}

interface UnmarkedStudent {
  clientId: string
  clientName: string
  wardId: string | null
  wardName: string | null
  phone: string | null
}

interface UnmarkedRow {
  lessonId: string
  lessonDate: string
  startTime: string
  groupName: string
  branchName: string
  directionName: string
  instructorName: string
  unmarkedStudents: UnmarkedStudent[]
}

export default async function UnmarkedReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const sp = await searchParams

  const { year, month } = getMonthFromParams(sp)
  const branchId = typeof sp.branchId === "string" ? sp.branchId : undefined

  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59))
  const now = new Date()

  // Branches for filter
  const branches = await db.branch.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  // Past lessons in the date range
  const lessonWhere: any = {
    tenantId,
    date: { gte: monthStart, lte: monthEnd < now ? monthEnd : now },
    status: { not: "cancelled" },
  }
  if (branchId) {
    lessonWhere.group = { branchId }
  }

  const lessons = await db.lesson.findMany({
    where: lessonWhere,
    select: {
      id: true,
      date: true,
      startTime: true,
      group: {
        select: {
          id: true,
          name: true,
          branch: { select: { name: true } },
          direction: { select: { name: true } },
        },
      },
      instructor: { select: { firstName: true, lastName: true } },
      substituteInstructor: { select: { firstName: true, lastName: true } },
      attendances: { select: { clientId: true, wardId: true } },
    },
    orderBy: [{ date: "desc" }, { startTime: "asc" }],
  })

  // Get enrollments for involved groups
  const groupIds = [...new Set(lessons.map((l) => l.group.id))]

  const enrollments = groupIds.length > 0
    ? await db.groupEnrollment.findMany({
        where: {
          tenantId,
          groupId: { in: groupIds },
          isActive: true,
          deletedAt: null,
        },
        select: {
          groupId: true,
          clientId: true,
          wardId: true,
          enrolledAt: true,
          selectedDays: true,
          client: { select: { id: true, firstName: true, lastName: true, phone: true } },
          ward: { select: { id: true, firstName: true, lastName: true } },
        },
      })
    : []

  const enrollmentsByGroup = new Map<string, typeof enrollments>()
  for (const e of enrollments) {
    const list = enrollmentsByGroup.get(e.groupId) || []
    list.push(e)
    enrollmentsByGroup.set(e.groupId, list)
  }

  const rows: UnmarkedRow[] = []

  for (const lesson of lessons) {
    const lessonDate = new Date(lesson.date)
    const dayOfWeek = lessonDate.getUTCDay() === 0 ? 7 : lessonDate.getUTCDay()

    const groupEnrollments = enrollmentsByGroup.get(lesson.group.id) || []

    const relevantEnrollments = groupEnrollments.filter((e) => {
      if (new Date(e.enrolledAt) > lessonDate) return false
      if (e.selectedDays && Array.isArray(e.selectedDays)) {
        return (e.selectedDays as number[]).includes(dayOfWeek)
      }
      return true
    })

    const markedSet = new Set(
      lesson.attendances.map((a) => `${a.clientId}|${a.wardId || ""}`)
    )

    const unmarked = relevantEnrollments.filter(
      (e) => !markedSet.has(`${e.clientId}|${e.wardId || ""}`)
    )

    if (unmarked.length > 0) {
      const instr = lesson.substituteInstructor || lesson.instructor
      rows.push({
        lessonId: lesson.id,
        lessonDate: lessonDate.toISOString().slice(0, 10),
        startTime: lesson.startTime,
        groupName: lesson.group.name,
        branchName: lesson.group.branch.name,
        directionName: lesson.group.direction.name,
        instructorName: [instr.lastName, instr.firstName].filter(Boolean).join(" "),
        unmarkedStudents: unmarked.map((e) => ({
          clientId: e.clientId,
          clientName: [e.client.lastName, e.client.firstName].filter(Boolean).join(" "),
          wardId: e.wardId,
          wardName: e.ward ? [e.ward.lastName, e.ward.firstName].filter(Boolean).join(" ") : null,
          phone: e.client.phone,
        })),
      })
    }
  }

  const totalUnmarked = rows.reduce((sum, r) => sum + r.unmarkedStudents.length, 0)
  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  const monthKey = `${year}-${String(month).padStart(2, "0")}`

  // Flatten for export
  const exportRows = rows.flatMap((r) =>
    r.unmarkedStudents.map((s) => ({
      date: formatDate(r.lessonDate),
      time: r.startTime,
      group: r.groupName,
      direction: r.directionName,
      instructor: r.instructorName,
      branch: r.branchName,
      student: s.wardName || s.clientName,
      client: s.clientName,
      phone: s.phone || "",
    }))
  )

  const buildFilterUrl = (params: Record<string, string | undefined>) => {
    const base = "/reports/attendance/unmarked"
    const query = new URLSearchParams()
    query.set("year", String(year))
    query.set("month", String(month))
    for (const [k, v] of Object.entries(params)) {
      if (v) query.set(k, v)
    }
    return `${base}?${query.toString()}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Неотмеченные дети</h1>
            <PageHelp pageKey="reports/attendance/unmarked" />
          </div>
          <p className="text-sm text-muted-foreground">Занятия, где не проставлены посещения</p>
        </div>
        <MonthPicker />
        <ReportExport
          title="Неотмеченные дети"
          filename={`unmarked-${monthKey}`}
          columns={[
            { header: "Дата", key: "date", width: 12 },
            { header: "Время", key: "time", width: 8 },
            { header: "Группа", key: "group", width: 22 },
            { header: "Направление", key: "direction", width: 22 },
            { header: "Педагог", key: "instructor", width: 22 },
            { header: "Филиал", key: "branch", width: 18 },
            { header: "Ученик", key: "student", width: 22 },
            { header: "Клиент", key: "client", width: 22 },
            { header: "Телефон", key: "phone", width: 16 },
          ]}
          rows={exportRows}
          period={monthName}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Период:</span>
        <Badge variant="outline">{monthName}</Badge>

        {branches.length > 1 && (
          <>
            <span className="ml-2 text-muted-foreground">Филиал:</span>
            <Link href={buildFilterUrl({})}>
              <Badge variant={!branchId ? "default" : "outline"}>Все</Badge>
            </Link>
            {branches.map((b) => (
              <Link key={b.id} href={buildFilterUrl({ branchId: b.id })}>
                <Badge variant={branchId === b.id ? "default" : "outline"}>{b.name}</Badge>
              </Link>
            ))}
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Занятий с пропусками</p>
            <p className="text-2xl font-bold text-orange-600">{rows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Неотмеченных учеников</p>
            <p className="text-2xl font-bold text-red-600">{totalUnmarked}</p>
          </CardContent>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Все занятия отмечены
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="size-4 text-orange-500" />
              Занятия без полной отметки
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Дата</TableHead>
                    <TableHead>Группа</TableHead>
                    <TableHead>Педагог</TableHead>
                    <TableHead>Неотмеченные ученики</TableHead>
                    <TableHead className="text-right">Кол-во</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.lessonId}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(r.lessonDate)}
                        <span className="ml-1 text-xs text-muted-foreground">{r.startTime}</span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{r.groupName}</div>
                        <div className="text-xs text-muted-foreground">{r.directionName}</div>
                      </TableCell>
                      <TableCell className="text-sm">{r.instructorName}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.unmarkedStudents.slice(0, 5).map((s) => (
                            <Badge key={s.clientId + (s.wardId || "")} variant="outline" className="text-xs">
                              {s.wardName || s.clientName}
                            </Badge>
                          ))}
                          {r.unmarkedStudents.length > 5 && (
                            <Badge variant="secondary" className="text-xs">
                              +{r.unmarkedStudents.length - 5}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium text-red-600">
                        {r.unmarkedStudents.length}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/schedule/lessons/${r.lessonId}`}
                          className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                        >
                          Открыть
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
