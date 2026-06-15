"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  adminId: string
  adminName: string
  branch: string
  trialsCompleted: number
  newClientSales: number
  upsales: number
  totalSales: number
}

export default function AdminMotivationReportPage() {
  const { loading, error, data } = useReportData<Row>("/api/reports/admin-motivation")

  return (
    <ReportShell
      title="Мотивация администратора"
      subtitle="Проведённые пробные, продажи новым и допродажи — по администраторам за месяц"
      pageKey="reports/salary/admin-motivation"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Администратор</TableHead>
                  <TableHead>Филиал</TableHead>
                  <TableHead className="text-right">Пробных проведено</TableHead>
                  <TableHead className="text-right">Продаж новым</TableHead>
                  <TableHead className="text-right">Допродаж</TableHead>
                  <TableHead className="text-right">Всего продаж</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.adminId}>
                    <TableCell className="font-medium">{r.adminName}</TableCell>
                    <TableCell className="text-sm">{r.branch}</TableCell>
                    <TableCell className="text-right">{r.trialsCompleted}</TableCell>
                    <TableCell className="text-right text-green-600">{r.newClientSales}</TableCell>
                    <TableCell className="text-right text-blue-600">{r.upsales}</TableCell>
                    <TableCell className="text-right font-bold">{r.totalSales}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Суммы бонусов рассчитываются по ставкам из «Настройки → Бонус администратора».
      </p>
    </ReportShell>
  )
}
