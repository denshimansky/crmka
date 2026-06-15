"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  campaignId: string
  campaignName: string
  status: string
  createdAt: string
  total: number
  processed: number
  trialScheduled: number
  sales: number
  noAnswer: number
  refused: number
  processedRate: number
  trialConversion: number
  saleConversion: number
}

export default function CallEfficiencyReportPage() {
  const { loading, error, data } = useReportData<Row>("/api/reports/call-efficiency")

  return (
    <ReportShell
      title="Эффективность обзвонов"
      subtitle="Результативность обзвонных кампаний за месяц (по дате создания кампании)"
      pageKey="reports/crm/call-efficiency"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus
            loading={loading}
            error={error}
            empty={data.length === 0}
            emptyText="За месяц обзвонных кампаний нет"
          />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Кампания</TableHead>
                  <TableHead className="text-right">Всего</TableHead>
                  <TableHead className="text-right">Отработано</TableHead>
                  <TableHead className="text-right">% отработки</TableHead>
                  <TableHead className="text-right">Пробные</TableHead>
                  <TableHead className="text-right">Конв. в пробное</TableHead>
                  <TableHead className="text-right">Продажи</TableHead>
                  <TableHead className="text-right">Конв. в продажу</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.campaignId}>
                    <TableCell className="font-medium">{r.campaignName}</TableCell>
                    <TableCell className="text-right">{r.total}</TableCell>
                    <TableCell className="text-right">{r.processed}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.processedRate}%</TableCell>
                    <TableCell className="text-right">{r.trialScheduled}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.trialConversion}%</TableCell>
                    <TableCell className="text-right font-medium text-blue-600">{r.sales}</TableCell>
                    <TableCell className="text-right font-bold">{r.saleConversion}%</TableCell>
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
