"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  instructorId: string
  instructorName: string
  revenue: number
  salary: number
  variableExpenses: number
  fixedExpenses: number
  profitability: number
  percentOfTotal: number
}

export default function InstructorProfitabilityReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/instructor-profitability")
  const totalNetProfit = Number(metadata?.totalNetProfit ?? 0)

  return (
    <ReportShell
      title="Сколько денег приносит педагог"
      subtitle="Выручка − ЗП − переменные − доля постоянных расходов = прибыльность педагога"
      pageKey="reports/salary/instructor-profitability"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Педагог</TableHead>
                  <TableHead className="text-right">Выручка</TableHead>
                  <TableHead className="text-right">ЗП</TableHead>
                  <TableHead className="text-right">Перем.</TableHead>
                  <TableHead className="text-right">Пост.</TableHead>
                  <TableHead className="text-right">Прибыльность</TableHead>
                  <TableHead className="text-right">% от общего</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.instructorId}>
                    <TableCell className="font-medium">{r.instructorName}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.revenue)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtMoney(r.salary)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtMoney(r.variableExpenses)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtMoney(r.fixedExpenses)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.profitability >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {fmtMoney(r.profitability)}
                    </TableCell>
                    <TableCell className="text-right font-bold">{r.percentOfTotal}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          Общая чистая прибыль за период: {fmtMoney(totalNetProfit)}. Погрешность до 5% из-за усреднения расходов.
        </p>
      )}
    </ReportShell>
  )
}
