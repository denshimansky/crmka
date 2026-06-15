"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  instructorId: string
  instructorName: string
  activeSubscriptions: number
  newSubscriptions: number
  churned: number
  activeAtEnd: number
}

export default function SubscriptionsByInstructorReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/subscriptions-by-instructor")
  const num = (k: string) => Number((metadata as Record<string, unknown> | null)?.[k] ?? 0)

  return (
    <ReportShell
      title="Сводный по абонементам в разрезе педагогов"
      subtitle="Активные, новые, выбывшие абонементы и активные на конец месяца — по педагогам"
      pageKey="reports/crm/subscriptions-by-instructor"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Педагог</TableHead>
                  <TableHead className="text-right">Активные</TableHead>
                  <TableHead className="text-right">Новые</TableHead>
                  <TableHead className="text-right">Выбывшие</TableHead>
                  <TableHead className="text-right">Активные на конец</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.instructorId}>
                    <TableCell className="font-medium">{r.instructorName}</TableCell>
                    <TableCell className="text-right">{r.activeSubscriptions}</TableCell>
                    <TableCell className="text-right text-green-600">{r.newSubscriptions}</TableCell>
                    <TableCell className="text-right text-red-600">{r.churned}</TableCell>
                    <TableCell className="text-right font-medium">{r.activeAtEnd}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Итого</TableCell>
                  <TableCell className="text-right">{num("totalActive")}</TableCell>
                  <TableCell className="text-right text-green-600">{num("totalNew")}</TableCell>
                  <TableCell className="text-right text-red-600">{num("totalChurned")}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
