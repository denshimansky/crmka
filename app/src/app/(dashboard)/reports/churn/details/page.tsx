import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { getRoleNames } from "@/lib/role-names"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, TrendingDown, Users } from "lucide-react"
import Link from "next/link"
import { BackButton } from "@/components/back-button"

function formatDate(date: Date | null): string {
  if (!date) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export default async function ChurnDetailsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const roleNames = await getRoleNames(tenantId)

  const { year, month } = getMonthFromParams(await searchParams)
  const dateFrom = new Date(Date.UTC(year, month - 1, 1))
  const dateToExclusive = new Date(Date.UTC(year, month, 1))

  // Отток считаем по ВЫБЫВШИМ АБОНЕМЕНТАМ за выбранный месяц
  // (Subscription.withdrawalDate = дата последнего платного занятия), а не по
  // Client.withdrawalDate (его кроны ставят датой запуска). Так фильтр периода
  // (MonthPicker) работает, а отчёт согласован с «Оттоком по инструкторам» и спекой.
  const subWhere: any = {
    deletedAt: null,
    status: "withdrawn",
    withdrawalDate: { gte: dateFrom, lt: dateToExclusive },
  }

  const churnedClients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      subscriptions: { some: subWhere },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      branch: { select: { name: true } },
      subscriptions: {
        where: subWhere,
        orderBy: { withdrawalDate: "desc" },
        take: 1,
        select: {
          withdrawalDate: true,
          periodMonth: true,
          periodYear: true,
          direction: { select: { name: true } },
          group: { select: { instructor: { select: { firstName: true, lastName: true } } } },
          withdrawalReason: { select: { name: true } },
        },
      },
    },
  })

  // Всего активных (текущий снимок — приблизительная база для % оттока)
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

  // Комментарий отчисления живёт в истории коммуникаций клиента (баг #108):
  // при переходе в withdrawn PATCH /api/subscriptions/[id] пишет заметку
  // Communication (type=note, channel=internal). Заметка создаётся только когда
  // комментарий заполнен, поэтому её наличие = комментарий был.
  const churnedIds = churnedClients.map((c) => c.id)
  const withdrawalNotes = churnedIds.length
    ? await db.communication.findMany({
        where: {
          tenantId,
          clientId: { in: churnedIds },
          type: "note",
          channel: "internal",
          content: { startsWith: "Отчисление абонемента «" },
        },
        select: { clientId: true, content: true },
        orderBy: { createdAt: "desc" },
      })
    : []
  const notesByClient = new Map<string, string[]>()
  for (const n of withdrawalNotes) {
    if (!n.content) continue // content nullable в схеме; startsWith-фильтр уже отсеял пустые
    const arr = notesByClient.get(n.clientId)
    if (arr) arr.push(n.content)
    else notesByClient.set(n.clientId, [n.content])
  }
  function withdrawalComment(clientId: string, directionName: string, period: string | null): string {
    const notes = notesByClient.get(clientId)
    if (!notes || notes.length === 0) return "—"
    // Сопоставляем заметку с показанным абонементом по ТОЧНОМУ авто-префиксу,
    // который пишет PATCH /api/subscriptions/[id] (направление + период). Точное
    // совпадение исключает подстановку чужого комментария (напр. у
    // бескомментарийного отчисления по другому направлению того же клиента) и
    // корректно отрезает префикс даже с «ёлочками» в названии направления. Если
    // направление/период поменяли после отчисления и совпадения нет — «—».
    const prefix = `Отчисление абонемента «${directionName}»${period ? ` (${period})` : ""}. `
    const note = notes.find((c) => c.startsWith(prefix))
    if (!note) return "—"
    return note.slice(prefix.length).trim() || "—"
  }

  const rows = churnedClients
    .map((c) => {
      const name = [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
      const sub = c.subscriptions[0]
      const direction = sub?.direction?.name || "—"
      const period =
        sub?.periodMonth && sub?.periodYear
          ? `${String(sub.periodMonth).padStart(2, "0")}.${sub.periodYear}`
          : null
      const instructor = sub?.group?.instructor
        ? [sub.group.instructor.lastName, sub.group.instructor.firstName].filter(Boolean).join(" ")
        : "—"
      return {
        id: c.id,
        name,
        branch: c.branch?.name || "—",
        direction,
        instructor,
        withdrawalDate: sub?.withdrawalDate ?? null,
        reason: sub?.withdrawalReason?.name || "—",
        comment: withdrawalComment(c.id, direction, period),
      }
    })
    .sort((a, b) => (b.withdrawalDate?.getTime() ?? 0) - (a.withdrawalDate?.getTime() ?? 0))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <BackButton fallbackHref="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </BackButton>
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
                <TableHead>{roleNames.instructor}</TableHead>
                <TableHead>Дата выбытия</TableHead>
                <TableHead>Причина отчисления</TableHead>
                <TableHead>Комментарий</TableHead>
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
                  <TableCell className="text-muted-foreground">{r.reason}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-pre-wrap">{r.comment}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
