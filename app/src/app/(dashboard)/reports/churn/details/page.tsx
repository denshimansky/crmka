import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, TrendingDown, Users } from "lucide-react"
import Link from "next/link"

function formatDate(date: Date | null): string {
  if (!date) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const WITHDRAWAL_REASONS: Record<string, string> = {
  no_interest: "Потерял интерес",
  financial: "Финансовые причины",
  moved: "Переезд",
  schedule: "Не подходит расписание",
  quality: "Качество услуг",
  other: "Другое",
}

export default async function ChurnDetailsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Выбывшие клиенты (clientStatus = churned или funnelStatus = archived)
  const churnedClients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      OR: [
        { clientStatus: "churned" },
        { funnelStatus: "archived" },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      withdrawalDate: true,
      clientStatus: true,
      funnelStatus: true,
      branch: { select: { name: true } },
      subscriptions: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          direction: { select: { name: true } },
          group: { select: { instructor: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
    orderBy: { withdrawalDate: "desc" },
  })

  const { year, month } = getMonthFromParams(await searchParams)

  // Всего активных
  const totalActive = await db.client.count({
    where: { tenantId, deletedAt: null, clientStatus: "active" },
  })

  const totalChurned = churnedClients.length

  // Отток по направлениям
  const churnByDirection = new Map<string, number>()
  for (const c of churnedClients) {
    const dir = c.subscriptions[0]?.direction?.name || "Без направления"
    churnByDirection.set(dir, (churnByDirection.get(dir) || 0) + 1)
  }

  // Отток по филиалам
  const churnByBranch = new Map<string, number>()
  for (const c of churnedClients) {
    const br = c.branch?.name || "Без филиала"
    churnByBranch.set(br, (churnByBranch.get(br) || 0) + 1)
  }

  const rows = churnedClients.map((c) => {
    const name = [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
    const direction = c.subscriptions[0]?.direction?.name || "—"
    const instructor = c.subscriptions[0]?.group?.instructor
      ? [c.subscriptions[0].group.instructor.lastName, c.subscriptions[0].group.instructor.firstName].filter(Boolean).join(" ")
      : "—"
    return {
      id: c.id,
      name,
      branch: c.branch?.name || "—",
      direction,
      instructor,
      withdrawalDate: c.withdrawalDate,
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
            <h1 className="text-2xl font-bold">Детализация оттока</h1>
            <PageHelp pageKey="reports/churn/details" />
          </div>
          <p className="text-sm text-muted-foreground">Выбывшие клиенты по направлениям и инструкторам</p>
        </div>
        <MonthPicker />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Выбывших</p>
            <p className="text-2xl font-bold text-red-600">{totalChurned}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Активных</p>
            <p className="text-2xl font-bold text-green-600">{totalActive}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">% оттока</p>
            <p className="text-2xl font-bold">
              {totalActive + totalChurned > 0
                ? Math.round((totalChurned / (totalActive + totalChurned)) * 100) + "%"
                : "0%"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* По направлениям */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">По направлениям</CardTitle>
          </CardHeader>
          <CardContent>
            {churnByDirection.size === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              <div className="space-y-2">
                {Array.from(churnByDirection.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([dir, count]) => (
                  <div key={dir} className="flex items-center justify-between text-sm">
                    <span>{dir}</span>
                    <Badge variant="outline">{count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* По филиалам */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">По филиалам</CardTitle>
          </CardHeader>
          <CardContent>
            {churnByBranch.size === 0 ? (
              <p className="text-sm text-muted-foreground">Нет данных</p>
            ) : (
              <div className="space-y-2">
                {Array.from(churnByBranch.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([br, count]) => (
                  <div key={br} className="flex items-center justify-between text-sm">
                    <span>{br}</span>
                    <Badge variant="outline">{count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Таблица */}
      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет выбывших клиентов
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Инструктор</TableHead>
                <TableHead>Дата выбытия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/crm/clients/${r.id}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.branch}</TableCell>
                  <TableCell>{r.direction}</TableCell>
                  <TableCell className="text-muted-foreground">{r.instructor}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.withdrawalDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
