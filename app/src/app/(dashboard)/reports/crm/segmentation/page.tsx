"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  segment: string
  label: string
  count: number
}

export default function SegmentationReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/client-segmentation")
  const total = Number(metadata?.totalClients ?? 0)

  return (
    <ReportShell
      title="Сегментация клиентов"
      subtitle="Активные клиенты по сегментам — автоматически по числу купленных абонементов (снимок на сегодня)"
      pageKey="reports/crm/segmentation"
      period={false}
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} emptyText="Активных клиентов нет" />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Сегмент</TableHead>
                  <TableHead className="text-right">Клиентов</TableHead>
                  <TableHead className="text-right">Доля</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.segment}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right">{r.count}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {total > 0 ? `${Math.round((r.count / total) * 100)}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Всего активных</TableCell>
                  <TableCell className="text-right">{total}</TableCell>
                  <TableCell className="text-right text-muted-foreground">100%</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
