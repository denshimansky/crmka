"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  managerId: string
  name: string
  leadsCreated: number
  subsCreated: number
  trialsScheduled: number
  trialsAttended: number
  sales: number
}

export default function LeadsByManagerReportPage() {
  const { loading, error, data } = useReportData<Row>("/api/reports/leads-by-manager")

  return (
    <ReportShell
      title="Лиды по менеджерам"
      subtitle="Создано лидов/заявок, записи на пробные и продажи — по сотрудникам за месяц"
      pageKey="reports/crm/leads-by-manager"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Менеджер</TableHead>
                  <TableHead className="text-right">Создано лидов</TableHead>
                  <TableHead className="text-right">Создано заявок</TableHead>
                  <TableHead className="text-right">Записано на пробные</TableHead>
                  <TableHead className="text-right">Пришли на пробные</TableHead>
                  <TableHead className="text-right">Продажи</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.managerId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.leadsCreated}</TableCell>
                    <TableCell className="text-right">{r.subsCreated}</TableCell>
                    <TableCell className="text-right">{r.trialsScheduled}</TableCell>
                    <TableCell className="text-right text-green-600">{r.trialsAttended}</TableCell>
                    <TableCell className="text-right font-bold text-blue-600">{r.sales}</TableCell>
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
