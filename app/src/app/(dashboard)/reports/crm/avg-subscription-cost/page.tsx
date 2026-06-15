"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  direction: string
  count: number
  total: number
  avg: number
}

export default function AvgSubscriptionCostReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/avg-subscription-cost")
  const activeSubs = Number(metadata?.activeSubscriptions ?? 0)
  const totalCharged = Number(metadata?.totalCharged ?? 0)
  const avgCost = Number(metadata?.avgSubscriptionCost ?? 0)

  return (
    <ReportShell
      title="Средняя стоимость абонемента"
      subtitle="Сумма отработанных / число активных абонементов за месяц"
      pageKey="reports/crm/avg-subscription-cost"
    >
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
    </ReportShell>
  )
}
