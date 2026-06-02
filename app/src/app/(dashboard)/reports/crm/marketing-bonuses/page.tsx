import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

function fmt(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₽"
}

export default async function MarketingBonusesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  const items = await db.bonusDiscount.findMany({
    where: {
      tenantId,
      deletedAt: null,
      date: { gte: monthStart, lte: monthEnd },
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      responsible: { select: { firstName: true, lastName: true } },
      channel: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  })

  const total = items.reduce((s, r) => s + Number(r.amount), 0)
  const marketingTotal = items
    .filter((r) => r.isMarketing)
    .reduce((s, r) => s + Number(r.amount), 0)

  const byChannel = new Map<string, { amount: number; count: number }>()
  for (const r of items) {
    if (!r.isMarketing) continue
    const key = r.channel?.name ?? "(не указан)"
    const prev = byChannel.get(key) ?? { amount: 0, count: 0 }
    prev.amount += Number(r.amount)
    prev.count += 1
    byChannel.set(key, prev)
  }

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Разовые скидки</h1>
            <PageHelp pageKey="reports/crm/marketing-bonuses" />
          </div>
          <p className="text-sm text-muted-foreground">
            Начисленные бонусы на баланс клиентов · {monthName}
          </p>
        </div>
        <MonthPicker />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Всего начислено за период
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(total)}</div>
            <div className="text-xs text-muted-foreground">{items.length} записей</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Из них маркетинговые
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmt(marketingTotal)}</div>
            <div className="text-xs text-muted-foreground">
              {items.filter((r) => r.isMarketing).length} записей
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Каналы
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-0.5">
            {byChannel.size === 0 ? (
              <div className="text-muted-foreground">—</div>
            ) : (
              [...byChannel.entries()]
                .sort((a, b) => b[1].amount - a[1].amount)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="truncate">{k}</span>
                    <span className="font-medium">{fmt(v.amount)}</span>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-sm text-muted-foreground">
            За {monthName} разовых скидок не начислялось
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Причина</TableHead>
                  <TableHead>Канал</TableHead>
                  <TableHead>Ответственный</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => {
                  const clientName =
                    [r.client.lastName, r.client.firstName].filter(Boolean).join(" ") || "Без имени"
                  const responsibleName = r.responsible
                    ? [r.responsible.lastName, r.responsible.firstName].filter(Boolean).join(" ")
                    : "—"
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{r.date.toLocaleDateString("ru-RU")}</TableCell>
                      <TableCell>
                        <Link
                          href={`/crm/clients/${r.client.id}`}
                          className="hover:underline font-medium"
                        >
                          {clientName}
                        </Link>
                      </TableCell>
                      <TableCell>{r.reason}</TableCell>
                      <TableCell>{r.isMarketing ? r.channel?.name ?? "(не указан)" : "—"}</TableCell>
                      <TableCell>{responsibleName}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(Number(r.amount))}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
