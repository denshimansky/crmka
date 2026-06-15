"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  lifetimeMonth: number
  count: number
}

export default function ChurnByMonthsReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/churn-by-months")
  const totalChurned = Number(metadata?.totalChurned ?? 0)
  const maxCount = data.reduce((m, r) => Math.max(m, r.count), 0)
  const counted = data.reduce((s, r) => s + r.count, 0)

  return (
    <ReportShell
      title="Отток по месяцам"
      subtitle="В какой месяц «срока жизни» чаще уходят клиенты (от даты продажи до последнего платного занятия)"
      pageKey="reports/churn/by-months"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Месяц жизни</TableHead>
                  <TableHead className="text-right">Выбыло</TableHead>
                  <TableHead>Распределение</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.lifetimeMonth}>
                    <TableCell className="font-medium">{r.lifetimeMonth}-й месяц</TableCell>
                    <TableCell className="text-right">{r.count}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-full max-w-[240px] overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-red-500"
                            style={{ width: maxCount > 0 ? `${(r.count / maxCount) * 100}%` : "0%" }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {counted > 0 ? `${Math.round((r.count / counted) * 100)}%` : "—"}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {!loading && !error && (
        <p className="text-xs text-muted-foreground">
          Всего выбывших за период: {totalChurned}. В распределение попадают клиенты с известной датой продажи.
        </p>
      )}
    </ReportShell>
  )
}
