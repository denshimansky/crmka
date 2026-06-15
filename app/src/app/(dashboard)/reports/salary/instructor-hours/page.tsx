"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  instructorId: string
  instructorName: string
  totalHours: number
  byDay: Record<string, number>
}

export default function InstructorHoursReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/instructor-hours")
  const totalHours = Number(metadata?.totalHours ?? 0)

  return (
    <ReportShell
      title="Часы педагогов по дням"
      subtitle="Отработанные часы за месяц (занятие с хотя бы 1 явкой; 30 мин = 0,5 ч)"
      pageKey="reports/salary/instructor-hours"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Педагог</TableHead>
                  <TableHead className="text-right">Дней с занятиями</TableHead>
                  <TableHead className="text-right">Всего часов</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.instructorId}>
                    <TableCell className="font-medium">{r.instructorName}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {Object.keys(r.byDay).length}
                    </TableCell>
                    <TableCell className="text-right font-medium">{r.totalHours} ч</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={2}>Итого</TableCell>
                  <TableCell className="text-right">{Math.round(totalHours * 10) / 10} ч</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
