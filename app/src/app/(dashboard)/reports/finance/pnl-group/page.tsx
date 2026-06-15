"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  groupId: string
  groupName: string
  direction: string
  branch: string
  instructor: string
  revenue: number
  instructorSalary: number
  variableExpenses: number
  fixedExpenses: number
  profit: number
  profitability: number
}

export default function PnlGroupReportPage() {
  const { loading, error, data } = useReportData<Row>("/api/reports/pnl-group")

  return (
    <ReportShell
      title="Финрез по группам (формат C)"
      subtitle="Прибыльность каждой группы: выручка − ЗП − доля переменных и постоянных расходов"
      pageKey="reports/finance/pnl-group"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Группа</TableHead>
                  <TableHead>Педагог</TableHead>
                  <TableHead className="text-right">Выручка</TableHead>
                  <TableHead className="text-right">ЗП</TableHead>
                  <TableHead className="text-right">Перем.</TableHead>
                  <TableHead className="text-right">Пост.</TableHead>
                  <TableHead className="text-right">Прибыль</TableHead>
                  <TableHead className="text-right">Рентаб.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.groupId}>
                    <TableCell>
                      <div className="font-medium">{r.groupName}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.direction} · {r.branch}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.instructor || "—"}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.revenue)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtMoney(r.instructorSalary)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtMoney(r.variableExpenses)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtMoney(r.fixedExpenses)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {fmtMoney(r.profit)}
                    </TableCell>
                    <TableCell className="text-right font-bold">{r.profitability}%</TableCell>
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
