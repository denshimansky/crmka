"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtDay } from "@/components/report-scaffold"

interface Row {
  date: string
  total: number
  byChannel: Record<string, number>
}

export default function LeadsByDayReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/leads-by-day")
  const totalLeads = Number(metadata?.totalLeads ?? 0)

  return (
    <ReportShell
      title="Лиды по дням"
      subtitle="Созданные заявки (абонементы) по дням месяца"
      pageKey="reports/crm/leads-by-day"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>День</TableHead>
                  <TableHead className="text-right">Создано заявок</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="font-medium">{fmtDay(r.date)}</TableCell>
                    <TableCell className="text-right">{r.total}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Итого за месяц</TableCell>
                  <TableCell className="text-right">{totalLeads}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
