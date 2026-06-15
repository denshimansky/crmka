"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtDay } from "@/components/report-scaffold"

interface Row {
  date: string
  scheduled: number
  attended: number
  purchased: number
}

export default function TrialsByDayReportPage() {
  const { loading, error, data } = useReportData<Row>("/api/reports/trials-by-day")
  const totals = data.reduce(
    (acc, r) => ({
      scheduled: acc.scheduled + r.scheduled,
      attended: acc.attended + r.attended,
      purchased: acc.purchased + r.purchased,
    }),
    { scheduled: 0, attended: 0, purchased: 0 },
  )

  return (
    <ReportShell
      title="Пробники по дням"
      subtitle="По дате записи: записались на пробное → посетили → купили абонемент"
      pageKey="reports/crm/trials-by-day"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>День записи</TableHead>
                  <TableHead className="text-right">Записались</TableHead>
                  <TableHead className="text-right">Посетили</TableHead>
                  <TableHead className="text-right">Купили</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.date}>
                    <TableCell className="font-medium">{fmtDay(r.date)}</TableCell>
                    <TableCell className="text-right">{r.scheduled}</TableCell>
                    <TableCell className="text-right text-green-600">{r.attended}</TableCell>
                    <TableCell className="text-right font-medium text-blue-600">{r.purchased}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Итого</TableCell>
                  <TableCell className="text-right">{totals.scheduled}</TableCell>
                  <TableCell className="text-right text-green-600">{totals.attended}</TableCell>
                  <TableCell className="text-right text-blue-600">{totals.purchased}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
