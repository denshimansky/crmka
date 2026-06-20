"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

const METHOD_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Банковский перевод",
  acquiring: "Эквайринг",
  online_yukassa: "ЮKassa",
  online_robokassa: "Робокасса",
  sbp_qr: "СБП (QR)",
}

interface MethodRow {
  method: string
  amount: number
  count: number
  avg: number
}

interface DirectionRow {
  direction: string
  count: number
  total: number
  avg: number
}

/** Вкладка «Средний чек»: средняя сумма оплаты по способам. */
function AvgCheckTab() {
  const { loading, error, data, metadata } = useReportData<MethodRow>("/api/reports/avg-check")
  const avgCheck = Number(metadata?.avgCheck ?? 0)
  const totalCount = Number(metadata?.totalCount ?? 0)
  const totalAmount = Number(metadata?.totalAmount ?? 0)

  return (
    <>
      <p className="text-sm text-muted-foreground">Средняя сумма оплаты по способам</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Средний чек</p>
            <p className="text-2xl font-bold">{fmtMoney(avgCheck)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Оплат за месяц</p>
            <p className="text-2xl font-bold text-blue-600">{totalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Сумма оплат</p>
            <p className="text-2xl font-bold text-green-600">{fmtMoney(totalAmount)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">По способам оплаты</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportStatus loading={loading} error={error} empty={data.length === 0} emptyText="Нет данных" />
          {!loading && !error && data.length > 0 && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Способ оплаты</TableHead>
                    <TableHead className="text-right">Кол-во</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                    <TableHead className="text-right">Средний чек</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((r) => (
                    <TableRow key={r.method}>
                      <TableCell className="font-medium">{METHOD_LABELS[r.method] || r.method}</TableCell>
                      <TableCell className="text-right">{r.count}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.amount)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.avg)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}

/** Вкладка «Средний абонемент»: сумма отработанных / число активных абонементов. */
function AvgSubscriptionTab() {
  const { loading, error, data, metadata } = useReportData<DirectionRow>("/api/reports/avg-subscription-cost")
  const activeSubs = Number(metadata?.activeSubscriptions ?? 0)
  const totalCharged = Number(metadata?.totalCharged ?? 0)
  const avgCost = Number(metadata?.avgSubscriptionCost ?? 0)

  return (
    <>
      <p className="text-sm text-muted-foreground">Сумма отработанных / число активных абонементов за месяц</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Средняя стоимость</p>
            <p className="text-2xl font-bold">{fmtMoney(avgCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Активных абонементов</p>
            <p className="text-2xl font-bold">{activeSubs}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Сумма отработанных</p>
            <p className="text-2xl font-bold">{fmtMoney(totalCharged)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Направление</TableHead>
                  <TableHead className="text-right">Абонементов</TableHead>
                  <TableHead className="text-right">Отработано</TableHead>
                  <TableHead className="text-right">Средняя стоимость</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.direction}>
                    <TableCell className="font-medium">{r.direction}</TableCell>
                    <TableCell className="text-right">{r.count}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.total)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(r.avg)}</TableCell>
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

export default function AvgCheckReportPage() {
  return (
    <ReportShell title="Средний чек/абонемент" pageKey="reports/crm/avg-check">
      <Tabs defaultValue="check">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="check">Средний чек</TabsTrigger>
          <TabsTrigger value="subscription">Средний абонемент</TabsTrigger>
        </TabsList>

        <TabsContent value="check" className="space-y-6 pt-4">
          <AvgCheckTab />
        </TabsContent>

        <TabsContent value="subscription" className="space-y-6 pt-4">
          <AvgSubscriptionTab />
        </TabsContent>
      </Tabs>
    </ReportShell>
  )
}
