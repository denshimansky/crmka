import { PageHelp } from "@/components/page-help"
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

export default async function NotRenewedReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const { year: currentYear, month: currentMonth } = getMonthFromParams(await searchParams)

  // Предыдущий месяц
  const prevDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1))
  const prevYear = prevDate.getFullYear()
  const prevMonth = prevDate.getMonth() + 1

  // Абонементы прошлого месяца (активные или закрытые)
  const lastMonthSubs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      periodYear: prevYear,
      periodMonth: prevMonth,
      status: { in: ["active", "closed"] },
    },
    select: {
      id: true,
      clientId: true,
      directionId: true,
      groupId: true,
      finalAmount: true,
      client: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
        },
      },
      direction: { select: { name: true } },
      group: { select: { name: true } },
    },
  })

  // Абонементы текущего месяца — чтобы проверить продление
  const currentMonthSubs = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      periodYear: currentYear,
      periodMonth: currentMonth,
    },
    select: { clientId: true, directionId: true },
  })

  // Множество "клиент+направление" с абонементом в текущем месяце
  const renewedSet = new Set(
    currentMonthSubs.map((s) => `${s.clientId}:${s.directionId}`)
  )

  // Непродлённые = были в прошлом месяце, нет в текущем (по клиент+направление)
  const notRenewed = lastMonthSubs.filter(
    (s) => !renewedSet.has(`${s.clientId}:${s.directionId}`)
  )

  const totalLastMonth = lastMonthSubs.length
  const totalNotRenewed = notRenewed.length
  const renewalRate =
    totalLastMonth > 0
      ? Math.round(((totalLastMonth - totalNotRenewed) / totalLastMonth) * 100)
      : 0
  const lostRevenue = notRenewed.reduce((s, sub) => s + Number(sub.finalAmount), 0)

  // По направлениям
  const byDirection = new Map<string, number>()
  for (const s of notRenewed) {
    const dir = s.direction.name
    byDirection.set(dir, (byDirection.get(dir) || 0) + 1)
  }

  const prevMonthName = prevDate.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  const rows = notRenewed.map((s) => {
    const name = [s.client.lastName, s.client.firstName].filter(Boolean).join(" ") || "Без имени"
    return {
      id: s.client.id,
      name,
      phone: s.client.phone || "—",
      direction: s.direction.name,
      group: s.group.name,
      amount: Number(s.finalAmount),
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Непродлённые абонементы</h1>
            <PageHelp pageKey="reports/churn/not-renewed" />
          </div>
          <p className="text-sm text-muted-foreground">
            Клиенты с абонементом за {prevMonthName}, не продлившие на текущий месяц
          </p>
        </div>
        <MonthPicker />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Абонементов за прошлый месяц</p>
            <p className="text-2xl font-bold">{totalLastMonth}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Не продлили</p>
            <p className="text-2xl font-bold text-red-600">{totalNotRenewed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Продление</p>
            <p className="text-2xl font-bold text-green-600">{renewalRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Упущенная выручка</p>
            <p className="text-2xl font-bold text-orange-600">{formatMoney(lostRevenue)}</p>
          </CardContent>
        </Card>
      </div>

      {/* По направлениям */}
      {byDirection.size > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">По направлениям</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Array.from(byDirection.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([dir, count]) => (
                  <div key={dir} className="flex items-center justify-between text-sm">
                    <span>{dir}</span>
                    <Badge variant="outline">{count}</Badge>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Таблица */}
      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет данных
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Группа</TableHead>
                <TableHead className="text-right">Сумма абонемента</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.id}-${i}`}>
                  <TableCell>
                    <Link href={`/crm/clients/${r.id}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.phone}</TableCell>
                  <TableCell>{r.direction}</TableCell>
                  <TableCell className="text-muted-foreground">{r.group}</TableCell>
                  <TableCell className="text-right">{formatMoney(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
