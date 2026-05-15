import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

function pct(part: number, whole: number): number {
  if (whole === 0) return 0
  return Math.round((part / whole) * 100)
}

export default async function TrialConversionReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const { year, month } = getMonthFromParams(await searchParams)
  const dateFrom = new Date(Date.UTC(year, month - 1, 1))
  const dateTo = new Date(Date.UTC(year, month, 0, 23, 59, 59))

  // Все пробные за период
  const trialsAll = await db.trialLesson.findMany({
    where: {
      tenantId,
      scheduledDate: { gte: dateFrom, lte: dateTo },
    },
    select: {
      id: true,
      status: true,
      clientId: true,
      group: {
        select: {
          instructorId: true,
          instructor: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })

  const attendedTrials = trialsAll.filter((t) => t.status === "attended")
  const noShowTrials = trialsAll.filter((t) => t.status === "no_show")
  const cancelledTrials = trialsAll.filter((t) => t.status === "cancelled")
  const scheduledTrials = trialsAll.filter((t) => t.status === "scheduled")

  // Конверсия в покупку: те, кто был на пробном и потом купил
  const attendedClientIds = [...new Set(attendedTrials.map((t) => t.clientId))]
  const purchased = attendedClientIds.length
    ? await db.client.findMany({
        where: {
          id: { in: attendedClientIds },
          tenantId,
          deletedAt: null,
          OR: [
            { firstPaymentDate: { not: null } },
            { firstPaidLessonDate: { not: null } },
          ],
        },
        select: { id: true },
      })
    : []
  const purchasedSet = new Set(purchased.map((c) => c.id))

  // Группировка по педагогам
  const byInstructor = new Map<
    string,
    { name: string; scheduled: number; attended: number; noShow: number; cancelled: number; sales: number }
  >()
  for (const t of trialsAll) {
    const key = t.group.instructorId
    const prev =
      byInstructor.get(key) ||
      {
        name: [t.group.instructor.lastName, t.group.instructor.firstName].filter(Boolean).join(" ") || "—",
        scheduled: 0,
        attended: 0,
        noShow: 0,
        cancelled: 0,
        sales: 0,
      }
    if (t.status === "scheduled") prev.scheduled += 1
    if (t.status === "attended") {
      prev.attended += 1
      if (purchasedSet.has(t.clientId)) prev.sales += 1
    }
    if (t.status === "no_show") prev.noShow += 1
    if (t.status === "cancelled") prev.cancelled += 1
    byInstructor.set(key, prev)
  }

  const rows = [...byInstructor.entries()]
    .map(([id, v]) => ({
      instructorId: id,
      ...v,
      conversionRate: pct(v.sales, v.attended),
      attendanceRate: pct(v.attended, v.attended + v.noShow),
    }))
    .sort((a, b) => b.conversionRate - a.conversionRate)

  const total = {
    all: trialsAll.length,
    scheduled: scheduledTrials.length,
    attended: attendedTrials.length,
    noShow: noShowTrials.length,
    cancelled: cancelledTrials.length,
    sales: purchasedSet.size,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Конверсия пробных</h1>
            <PageHelp pageKey="reports/crm/trial-conversion" />
          </div>
          <p className="text-sm text-muted-foreground">
            Сколько пробных проведено и сколько превратилось в клиента — по педагогам
          </p>
        </div>
        <MonthPicker />
      </div>

      {/* Сводка */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Всего пробных</p>
            <p className="text-2xl font-bold">{total.all}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Запланировано</p>
            <p className="text-2xl font-bold text-muted-foreground">{total.scheduled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Пришли</p>
            <p className="text-2xl font-bold text-green-600">{total.attended}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Не пришли</p>
            <p className="text-2xl font-bold text-orange-600">{total.noShow}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Отменены</p>
            <p className="text-2xl font-bold text-muted-foreground">{total.cancelled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Купили после</p>
            <p className="text-2xl font-bold text-blue-600">
              {total.sales}
              {total.attended > 0 && (
                <span className="ml-1 text-sm text-muted-foreground">
                  ({pct(total.sales, total.attended)}%)
                </span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Таблица по педагогам */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">По педагогам</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              За выбранный месяц пробных не было
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Педагог</TableHead>
                  <TableHead className="text-right">Запланировано</TableHead>
                  <TableHead className="text-right">Пришли</TableHead>
                  <TableHead className="text-right">Не пришли</TableHead>
                  <TableHead className="text-right">% явок</TableHead>
                  <TableHead className="text-right">Купили</TableHead>
                  <TableHead className="text-right">Конверсия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.instructorId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.scheduled}</TableCell>
                    <TableCell className="text-right text-green-600 font-medium">{r.attended}</TableCell>
                    <TableCell className="text-right text-orange-600">{r.noShow}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {r.attended + r.noShow > 0 ? `${r.attendanceRate}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right text-blue-600 font-medium">{r.sales}</TableCell>
                    <TableCell className="text-right font-bold">
                      {r.attended > 0 ? `${r.conversionRate}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
