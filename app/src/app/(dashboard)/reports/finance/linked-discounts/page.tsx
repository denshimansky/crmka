"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  subscriptionId: string
  clientId: string
  clientName: string
  wardName: string | null
  direction: string
  group: string
  branch: string | null
  period: string | null
  sourceLabel: string
  templateName: string | null
  discountPerLesson: number
  discountAmount: number
  finalAmount: number
}

export default function LinkedDiscountsReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/linked-discounts")
  const totalAmount = Number(metadata?.totalAmount ?? 0)
  const total = Number(metadata?.totalDiscountedSubscriptions ?? data.length)

  return (
    <ReportShell
      title="Действующие скидки"
      subtitle="Абонементы с активной скидкой (снимок на сегодня)"
      pageKey="reports/finance/linked-discounts"
      period={false}
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} emptyText="Абонементов со скидками нет" />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент / ребёнок</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead>Тип скидки</TableHead>
                  <TableHead className="text-right">Скидка/занятие</TableHead>
                  <TableHead className="text-right">Сумма скидки</TableHead>
                  <TableHead className="text-right">Итоговая цена</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.subscriptionId}>
                    <TableCell className="font-medium">
                      <Link href={`/crm/clients/${r.clientId}`} className="hover:underline">
                        {r.wardName || r.clientName}
                      </Link>
                      {r.wardName && <div className="text-xs text-muted-foreground">{r.clientName}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{r.direction}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.period || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{r.sourceLabel}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{fmtMoney(r.discountPerLesson)}</TableCell>
                    <TableCell className="text-right text-orange-600">{fmtMoney(r.discountAmount)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(r.finalAmount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={5}>Итого ({total})</TableCell>
                  <TableCell className="text-right text-orange-600">{fmtMoney(totalAmount)}</TableCell>
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
