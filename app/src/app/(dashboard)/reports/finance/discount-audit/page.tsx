"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney, fmtDay } from "@/components/report-scaffold"

interface Row {
  discountId: string
  createdAt: string
  createdBy: string | null
  clientId: string
  clientName: string
  direction: string
  branch: string
  type: string
  value: number
  valueType: string
  calculatedAmount: number
  comment: string | null
}

export default function DiscountAuditReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/discount-audit")
  const total = Number(metadata?.totalDiscounts ?? data.length)
  const totalAmount = Number(metadata?.totalAmount ?? 0)

  return (
    <ReportShell
      title="Контроль скидок (аудит)"
      subtitle="Кто и когда создавал скидки за месяц"
      pageKey="reports/finance/discount-audit"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} emptyText="Скидок за месяц не создавали" />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Кто создал</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Филиал</TableHead>
                  <TableHead className="text-right">Размер</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.discountId}>
                    <TableCell className="whitespace-nowrap text-sm">{fmtDay(r.createdAt)}</TableCell>
                    <TableCell className="text-sm">{r.createdBy || "—"}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/crm/clients/${r.clientId}`} className="hover:underline">{r.clientName}</Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.direction}</TableCell>
                    <TableCell className="text-sm">{r.branch}</TableCell>
                    <TableCell className="text-right text-sm">
                      {r.valueType === "percent" ? `${r.value}%` : fmtMoney(r.value)}
                    </TableCell>
                    <TableCell className="text-right text-orange-600">{fmtMoney(r.calculatedAmount)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.comment || "—"}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={6}>Итого ({total})</TableCell>
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
