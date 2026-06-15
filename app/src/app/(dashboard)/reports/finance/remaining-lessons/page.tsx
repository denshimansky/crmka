"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  clientId: string
  clientName: string
  direction: string
  group: string
  totalLessons: number
  attendedLessons: number
  remainingLessons: number
  balanceToday: number
  endDate: string | null
  isActive: boolean
}

export default function RemainingLessonsReportPage() {
  const { loading, error, data } = useReportData<Row>("/api/reports/remaining-lessons")

  return (
    <ReportShell
      title="Остатки оплаченных занятий"
      subtitle="Сколько занятий осталось по абонементам месяца и баланс на сегодня"
      pageKey="reports/finance/remaining-lessons"
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
                  <TableHead>Группа</TableHead>
                  <TableHead className="text-right">Всего</TableHead>
                  <TableHead className="text-right">Отхожено</TableHead>
                  <TableHead className="text-right">Остаток</TableHead>
                  <TableHead className="text-right">Баланс</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r, i) => (
                  <TableRow key={`${r.clientId}-${i}`} className={!r.isActive ? "text-muted-foreground" : ""}>
                    <TableCell className="font-medium">
                      <Link href={`/crm/clients/${r.clientId}`} className="hover:underline">{r.clientName}</Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.direction}</TableCell>
                    <TableCell className="text-sm">{r.group}</TableCell>
                    <TableCell className="text-right">{r.totalLessons}</TableCell>
                    <TableCell className="text-right">{r.attendedLessons}</TableCell>
                    <TableCell className="text-right font-medium">{r.remainingLessons}</TableCell>
                    <TableCell className={`text-right ${r.balanceToday < 0 ? "text-red-600" : ""}`}>
                      {fmtMoney(r.balanceToday)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        У выбывших с остатком денег остаток занятий = 0 (при возврате стоимость может измениться) — ориентируйтесь на «Баланс».
      </p>
    </ReportShell>
  )
}
