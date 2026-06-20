"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

// ── Разовые скидки (бонусы на баланс за месяц) ──
interface BonusRow {
  id: string
  date: string
  clientId: string
  clientName: string
  reason: string
  isMarketing: boolean
  channelName: string | null
  responsibleName: string | null
  amount: number
}
interface ChannelAgg {
  name: string
  amount: number
  count: number
}

// ── Постоянные скидки (действующие скидки на абонементы, снимок) ──
interface DiscountRow {
  subscriptionId: string
  clientId: string
  clientName: string
  wardName: string | null
  direction: string
  period: string | null
  sourceLabel: string
  discountPerLesson: number
  discountAmount: number
  finalAmount: number
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU")
}

/** Вкладка «Разовые скидки» — начисленные бонусы на баланс клиентов за месяц. */
function OneTimeTab() {
  const { loading, error, data, metadata } = useReportData<BonusRow>("/api/reports/marketing-bonuses")
  const total = Number(metadata?.total ?? 0)
  const count = Number(metadata?.count ?? 0)
  const marketingTotal = Number(metadata?.marketingTotal ?? 0)
  const marketingCount = Number(metadata?.marketingCount ?? 0)
  const byChannel = (metadata?.byChannel as ChannelAgg[] | undefined) ?? []

  return (
    <>
      <p className="text-sm text-muted-foreground">Начисленные бонусы на баланс клиентов за месяц</p>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Всего начислено за период</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtMoney(total)}</div>
            <div className="text-xs text-muted-foreground">{count} записей</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Из них маркетинговые</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fmtMoney(marketingTotal)}</div>
            <div className="text-xs text-muted-foreground">{marketingCount} записей</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Каналы</CardTitle>
          </CardHeader>
          <CardContent className="space-y-0.5 text-sm">
            {byChannel.length === 0 ? (
              <div className="text-muted-foreground">—</div>
            ) : (
              byChannel.map((c) => (
                <div key={c.name} className="flex justify-between">
                  <span className="truncate">{c.name}</span>
                  <span className="font-medium">{fmtMoney(c.amount)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <ReportStatus
            loading={loading}
            error={error}
            empty={data.length === 0}
            emptyText="За выбранный месяц разовых скидок не начислялось"
          />
          {!loading && !error && data.length > 0 && (
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
                {data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDate(r.date)}</TableCell>
                    <TableCell>
                      <Link href={`/crm/clients/${r.clientId}`} className="font-medium hover:underline">
                        {r.clientName}
                      </Link>
                    </TableCell>
                    <TableCell>{r.reason}</TableCell>
                    <TableCell>{r.isMarketing ? r.channelName ?? "(не указан)" : "—"}</TableCell>
                    <TableCell>{r.responsibleName ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}

/** Вкладка «Постоянные скидки» — абонементы с действующей скидкой (снимок на сегодня). */
function RecurringTab() {
  const { loading, error, data, metadata } = useReportData<DiscountRow>("/api/reports/linked-discounts")
  const totalAmount = Number(metadata?.totalAmount ?? 0)
  const total = Number(metadata?.totalDiscountedSubscriptions ?? data.length)

  return (
    <>
      <p className="text-sm text-muted-foreground">Абонементы с действующей скидкой (снимок на сегодня)</p>

      <Card>
        <CardContent className="p-0">
          <ReportStatus
            loading={loading}
            error={error}
            empty={data.length === 0}
            emptyText="Абонементов со скидками нет"
          />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент / ребёнок</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead>Тип скидки</TableHead>
                  <TableHead className="text-right">Скидка/занятие</TableHead>
                  <TableHead className="text-right">Сумма скидки</TableHead>
                  <TableHead className="text-right">Итоговая цена</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.subscriptionId}>
                    <TableCell className="font-medium">
                      <Link href={`/crm/clients/${r.clientId}`} className="hover:underline">
                        {r.wardName || r.clientName}
                      </Link>
                      {r.wardName && <div className="text-xs text-muted-foreground">{r.clientName}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{r.direction}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.period || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{r.sourceLabel}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{fmtMoney(r.discountPerLesson)}</TableCell>
                    <TableCell className="text-right text-orange-600">{fmtMoney(r.discountAmount)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(r.finalAmount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={5}>Итого ({total})</TableCell>
                  <TableCell className="text-right text-orange-600">{fmtMoney(totalAmount)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}

export default function DiscountsReportPage() {
  return (
    <ReportShell
      title="Скидки"
      subtitle="Разовые бонусы на баланс и постоянные скидки на абонементы"
      pageKey="reports/crm/marketing-bonuses"
    >
      <Tabs defaultValue="onetime">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="onetime">Разовые скидки</TabsTrigger>
          <TabsTrigger value="recurring">Постоянные скидки</TabsTrigger>
        </TabsList>

        <TabsContent value="onetime" className="space-y-6 pt-4">
          <OneTimeTab />
        </TabsContent>

        <TabsContent value="recurring" className="space-y-6 pt-4">
          <RecurringTab />
        </TabsContent>
      </Tabs>
    </ReportShell>
  )
}
