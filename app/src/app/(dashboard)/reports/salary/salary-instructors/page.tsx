"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  instructorId: string
  instructorName: string
  accrued: number
  bonusFirstHalf: number
  bonusSecondHalf: number
  penaltyFirstHalf: number
  penaltySecondHalf: number
  totalPaid: number
  remaining: number
}

export default function SalaryInstructorsReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/salary-instructors")
  const num = (k: string) => Number((metadata as Record<string, unknown> | null)?.[k] ?? 0)

  return (
    <ReportShell
      title="Расчёты с педагогами"
      subtitle="Начислено, премии, штрафы, выплачено и остаток к выплате по педагогам за месяц"
      pageKey="reports/salary/salary-instructors"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Педагог</TableHead>
                  <TableHead className="text-right">Начислено</TableHead>
                  <TableHead className="text-right">Премии</TableHead>
                  <TableHead className="text-right">Штрафы</TableHead>
                  <TableHead className="text-right">Выплачено</TableHead>
                  <TableHead className="text-right">Осталось</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => {
                  const bonus = r.bonusFirstHalf + r.bonusSecondHalf
                  const penalty = r.penaltyFirstHalf + r.penaltySecondHalf
                  return (
                    <TableRow key={r.instructorId}>
                      <TableCell className="font-medium">{r.instructorName}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.accrued)}</TableCell>
                      <TableCell className="text-right text-green-600">{bonus ? fmtMoney(bonus) : "—"}</TableCell>
                      <TableCell className="text-right text-red-600">{penalty ? fmtMoney(penalty) : "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{fmtMoney(r.totalPaid)}</TableCell>
                      <TableCell className="text-right font-bold">{fmtMoney(r.remaining)}</TableCell>
                    </TableRow>
                  )
                })}
                <TableRow className="border-t-2 font-bold">
                  <TableCell>Итого</TableCell>
                  <TableCell className="text-right">{fmtMoney(num("totalAccrued"))}</TableCell>
                  <TableCell colSpan={2} />
                  <TableCell className="text-right">{fmtMoney(num("totalPaid"))}</TableCell>
                  <TableCell className="text-right">{fmtMoney(num("totalRemaining"))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Для руководителя актуальнее «Зарплата» (раздел «Зарплата» в меню); этот отчёт — для бухгалтерской сверки.
      </p>
    </ReportShell>
  )
}
