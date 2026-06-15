"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  clientId: string
  clientName: string
  direction: string
  beginBalance: number
  planCharge: number
  factCharge: number
  paidInPeriod: number
  endBalance: number
}

function balanceCell(v: number) {
  const cls = v < 0 ? "text-red-600" : v > 0 ? "text-green-600" : "text-muted-foreground"
  return <span className={cls}>{fmtMoney(v)}</span>
}

export default function StudentSettlementsReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/student-settlements")
  const num = (k: string) => Number((metadata as Record<string, unknown> | null)?.[k] ?? 0)

  return (
    <ReportShell
      title="Расчёты с учениками"
      subtitle="Начальный баланс, начисление план/факт, оплата и конечный баланс за месяц"
      pageKey="reports/finance/student-settlements"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ученик</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead className="text-right">Нач. баланс</TableHead>
                  <TableHead className="text-right">Начислено (план)</TableHead>
                  <TableHead className="text-right">Начислено (факт)</TableHead>
                  <TableHead className="text-right">Оплата</TableHead>
                  <TableHead className="text-right">Кон. баланс</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r, i) => (
                  <TableRow key={`${r.clientId}-${r.direction}-${i}`}>
                    <TableCell className="font-medium">
                      <Link href={`/crm/clients/${r.clientId}`} className="hover:underline">
                        {r.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.direction}</TableCell>
                    <TableCell className="text-right">{balanceCell(r.beginBalance)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.planCharge)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.factCharge)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.paidInPeriod)}</TableCell>
                    <TableCell className="text-right">{balanceCell(r.endBalance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={3}>Итого ({num("totalClients")})</TableCell>
                  <TableCell className="text-right">{fmtMoney(num("totalPlan"))}</TableCell>
                  <TableCell className="text-right">{fmtMoney(num("totalFact"))}</TableCell>
                  <TableCell className="text-right">{fmtMoney(num("totalPaid"))}</TableCell>
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
