"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  category: string
  amount: number
  percentOfRevenue: number
}

export default function FinancialDistributionReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/financial-distribution")
  const num = (k: string) => Number((metadata as Record<string, unknown> | null)?.[k] ?? 0)

  return (
    <ReportShell
      title="% распределения финреза"
      subtitle="Доля каждой статьи расходов и ЗП в выручке за месяц"
      pageKey="reports/finance/financial-distribution"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Выручка</p>
          <p className="text-2xl font-bold">{fmtMoney(num("revenue"))}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Расходы + ЗП</p>
          <p className="text-2xl font-bold text-red-600">{fmtMoney(num("totalExpenses"))}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Чистая прибыль</p>
          <p className={`text-2xl font-bold ${num("netProfit") >= 0 ? "text-green-600" : "text-red-600"}`}>
            {fmtMoney(num("netProfit"))} <span className="text-sm text-muted-foreground">({num("profitPercent")}%)</span>
          </p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Статья</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead className="text-right">% от выручки</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.category}>
                    <TableCell className="font-medium">{r.category}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.amount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.percentOfRevenue}%</TableCell>
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
