"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney, fmtDay } from "@/components/report-scaffold"

interface Row {
  date: string
  cash: number
  noncash: number
  total: number
  byAccount: Record<string, number>
}

export default function DailyIncomeReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/daily-income")
  const totalAmount = Number(metadata?.totalAmount ?? 0)
  const totals = data.reduce(
    (acc, r) => ({ cash: acc.cash + r.cash, noncash: acc.noncash + r.noncash }),
    { cash: 0, noncash: 0 },
  )

  return (
    <ReportShell
      title="Поступления по дням"
      subtitle="Ежедневные поступления от клиентов в разрезе нал/безнал"
      pageKey="reports/finance/daily-income"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>День</TableHead>
                  <TableHead className="text-right">Наличные</TableHead>
                  <TableHead className="text-right">Безнал</TableHead>
                  <TableHead className="text-right">Всего</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="font-medium">{fmtDay(r.date)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.cash)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.noncash)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(r.total)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Итого за месяц</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.cash)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totals.noncash)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totalAmount)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
