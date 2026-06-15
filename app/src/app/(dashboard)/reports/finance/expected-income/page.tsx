"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  direction: string
  subAmount: number
  expected: number
  paid: number
  debtPercent: number
}

export default function ExpectedIncomeReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/expected-income")
  const m = metadata || {}
  const num = (k: string) => Number((m as Record<string, unknown>)[k] ?? 0)

  return (
    <ReportShell
      title="Ожидаемые поступления"
      subtitle="Неоплаченные абонементы активных клиентов за месяц + прогноз на следующий"
      pageKey="reports/finance/expected-income"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Сумма абонементов</p>
            <p className="text-2xl font-bold">{fmtMoney(num("totalSubAmount"))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Ожидается (долг)</p>
            <p className="text-2xl font-bold text-orange-600">{fmtMoney(num("expectedIncome"))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Оплачено</p>
            <p className="text-2xl font-bold text-green-600">{fmtMoney(num("totalPaid"))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">% долга</p>
            <p className="text-2xl font-bold">{num("debtPercent")}%</p>
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
                  <TableHead className="text-right">Сумма абонементов</TableHead>
                  <TableHead className="text-right">Ожидается</TableHead>
                  <TableHead className="text-right">Оплачено</TableHead>
                  <TableHead className="text-right">% долга</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.direction}>
                    <TableCell className="font-medium">{r.direction}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.subAmount)}</TableCell>
                    <TableCell className="text-right text-orange-600">{fmtMoney(r.expected)}</TableCell>
                    <TableCell className="text-right text-green-600">{fmtMoney(r.paid)}</TableCell>
                    <TableCell className="text-right">{r.debtPercent}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!loading && !error && (
        <p className="text-sm text-muted-foreground">
          Прогноз на следующий месяц: <span className="font-medium text-foreground">{fmtMoney(num("nextMonthForecast"))}</span>{" "}
          по {num("nextMonthSubCount")} абонементам активной базы. Сумма скидок за месяц: {fmtMoney(num("totalDiscount"))}.
        </p>
      )}
    </ReportShell>
  )
}
