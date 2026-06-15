"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney, fmtDay } from "@/components/report-scaffold"

interface Row {
  auditId: string
  date: string
  changedBy: string
  clientName: string
  direction: string | null
  lessonDate: string | null
  oldAmount: number | null
  newAmount: number | null
  difference: number | null
}

export default function LessonAdjustmentsAuditReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/lesson-adjustments-audit")
  const total = Number(metadata?.totalAdjustments ?? data.length)

  return (
    <ReportShell
      title="Контроль корректировок занятий (аудит)"
      subtitle="Кто и когда менял стоимость отметок посещений за месяц"
      pageKey="reports/finance/lesson-adjustments-audit"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} emptyText="Корректировок за месяц не было" />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата изменения</TableHead>
                  <TableHead>Кто изменил</TableHead>
                  <TableHead>Ученик</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Занятие</TableHead>
                  <TableHead className="text-right">Было</TableHead>
                  <TableHead className="text-right">Стало</TableHead>
                  <TableHead className="text-right">Разница</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.auditId}>
                    <TableCell className="whitespace-nowrap text-sm">{fmtDay(r.date)}</TableCell>
                    <TableCell className="text-sm">{r.changedBy}</TableCell>
                    <TableCell className="font-medium">{r.clientName}</TableCell>
                    <TableCell className="text-sm">{r.direction || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.lessonDate ? fmtDay(r.lessonDate) : "—"}</TableCell>
                    <TableCell className="text-right">{r.oldAmount != null ? fmtMoney(r.oldAmount) : "—"}</TableCell>
                    <TableCell className="text-right">{r.newAmount != null ? fmtMoney(r.newAmount) : "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${(r.difference ?? 0) < 0 ? "text-red-600" : (r.difference ?? 0) > 0 ? "text-green-600" : ""}`}>
                      {r.difference != null ? fmtMoney(r.difference) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {!loading && !error && data.length > 0 && (
        <p className="text-xs text-muted-foreground">Всего корректировок: {total}</p>
      )}
    </ReportShell>
  )
}
