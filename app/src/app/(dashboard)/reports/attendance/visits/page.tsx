import { MonthPicker, getMonthFromParams } from "@/components/month-picker"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

function formatPercent(value: number, total: number): string {
  if (total === 0) return "0%"
  return Math.round((value / total) * 100) + "%"
}

const TYPE_LABELS: Record<string, string> = {
  present: "Присутствовал",
  absent: "Отсутствовал",
  recalculation: "Перерасчёт",
  makeup: "Отработка",
  trial: "Пробное",
}

export default async function VisitsReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: monthStart, lte: monthEnd } },
    },
    select: {
      id: true,
      attendanceType: { select: { code: true, name: true } },
      lesson: {
        select: {
          group: { select: { id: true, name: true, direction: { select: { name: true } } } },
        },
      },
    },
  })

  const totalVisits = attendances.length

  // По типам посещений
  const byType = new Map<string, { name: string; count: number }>()
  for (const a of attendances) {
    const code = a.attendanceType.code
    const prev = byType.get(code) || { name: TYPE_LABELS[code] || a.attendanceType.name, count: 0 }
    prev.count += 1
    byType.set(code, prev)
  }

  const typeRows = Array.from(byType.entries())
    .sort((a, b) => b[1].count - a[1].count)

  // По группам
  const byGroup = new Map<string, { name: string; direction: string; count: number }>()
  for (const a of attendances) {
    const groupId = a.lesson.group.id
    const prev = byGroup.get(groupId) || {
      name: a.lesson.group.name,
      direction: a.lesson.group.direction.name,
      count: 0,
    }
    prev.count += 1
    byGroup.set(groupId, prev)
  }

  const groupRows = Array.from(byGroup.values())
    .sort((a, b) => b.count - a.count)

  const presentCount = byType.get("present")?.count || 0
  const absentCount = byType.get("absent")?.count || 0
  const attendanceRate = totalVisits > 0 ? Math.round((presentCount / totalVisits) * 100) : 0

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Посещения</h1>
          <p className="text-sm text-muted-foreground">Отчёт по посещаемости за месяц</p>
        </div>
        <MonthPicker />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Всего отметок</p>
            <p className="text-2xl font-bold">{totalVisits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Присутствовали</p>
            <p className="text-2xl font-bold text-green-600">{presentCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Отсутствовали</p>
            <p className="text-2xl font-bold text-red-600">{absentCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Посещаемость</p>
            <p className="text-2xl font-bold text-blue-600">{attendanceRate}%</p>
          </CardContent>
        </Card>
      </div>

      {/* По типам */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">По типам отметок</CardTitle>
        </CardHeader>
        <CardContent>
          {typeRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет данных</p>
          ) : (
            <div className="space-y-2">
              {typeRows.map(([code, data]) => (
                <div key={code} className="flex items-center justify-between text-sm">
                  <span>{data.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{data.count}</span>
                    <Badge variant="outline" className="text-xs">
                      {formatPercent(data.count, totalVisits)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* По группам */}
      {groupRows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет данных
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">По группам</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Группа</TableHead>
                    <TableHead>Направление</TableHead>
                    <TableHead className="text-right">Отметок</TableHead>
                    <TableHead className="text-right">Доля</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupRows.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground">{r.direction}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{formatPercent(r.count, totalVisits)}</TableCell>
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
