import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(amount)) + " ₽"
}

export default async function RevenueReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  // Выручка = списания с абонементов за отработанные занятия (countsAsRevenue)
  const attendances = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: monthStart, lte: monthEnd } },
      attendanceType: { countsAsRevenue: true },
    },
    select: {
      chargeAmount: true,
      subscription: {
        select: {
          direction: { select: { id: true, name: true } },
        },
      },
    },
  })

  const totalRevenue = attendances.reduce((s, a) => s + Number(a.chargeAmount), 0)
  const totalLessons = attendances.length

  // Группировка по направлениям
  const byDirection = new Map<string, { name: string; amount: number; count: number }>()
  for (const a of attendances) {
    const dirId = a.subscription?.direction?.id || "unknown"
    const dirName = a.subscription?.direction?.name || "Без направления"
    const prev = byDirection.get(dirId) || { name: dirName, amount: 0, count: 0 }
    prev.amount += Number(a.chargeAmount)
    prev.count += 1
    byDirection.set(dirId, prev)
  }

  const directionRows = Array.from(byDirection.values())
    .sort((a, b) => b.amount - a.amount)

  const avgPerLesson = totalLessons > 0 ? totalRevenue / totalLessons : 0

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Выручка</h1>
          <p className="text-sm text-muted-foreground">Выручка от отработанных занятий по направлениям</p>
        </div>
        <MonthPicker />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Выручка</p>
            <p className="text-2xl font-bold text-green-600">{formatMoney(totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Отработанных занятий</p>
            <p className="text-2xl font-bold text-blue-600">{totalLessons}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Средняя выручка за занятие</p>
            <p className="text-2xl font-bold">{formatMoney(avgPerLesson)}</p>
          </CardContent>
        </Card>
      </div>

      {directionRows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет данных
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">По направлениям</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Направление</TableHead>
                    <TableHead className="text-right">Занятий</TableHead>
                    <TableHead className="text-right">Выручка</TableHead>
                    <TableHead className="text-right">Доля</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {directionRows.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{formatMoney(r.amount)}</TableCell>
                      <TableCell className="text-right">
                        {totalRevenue > 0 ? Math.round((r.amount / totalRevenue) * 100) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold">
                    <TableCell>Итого</TableCell>
                    <TableCell className="text-right">{totalLessons}</TableCell>
                    <TableCell className="text-right">{formatMoney(totalRevenue)}</TableCell>
                    <TableCell className="text-right">100%</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
