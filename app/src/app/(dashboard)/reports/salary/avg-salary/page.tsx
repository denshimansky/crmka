"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  instructorId: string
  instructorName: string
  hours: number
  salary: number
  avgHourRate: number
}

export default function AvgSalaryReportPage() {
  const { loading, error, data } = useReportData<Row>("/api/reports/avg-salary")

  return (
    <ReportShell
      title="Средняя ЗП педагогов"
      subtitle="Средняя стоимость часа = начисленная ЗП / отработанные часы"
      pageKey="reports/salary/avg-salary"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Педагог</TableHead>
                  <TableHead className="text-right">Часов</TableHead>
                  <TableHead className="text-right">Начислено</TableHead>
                  <TableHead className="text-right">Средняя стоимость часа</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.instructorId}>
                    <TableCell className="font-medium">{r.instructorName}</TableCell>
                    <TableCell className="text-right">{r.hours} ч</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.salary)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(r.avgHourRate)}</TableCell>
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
