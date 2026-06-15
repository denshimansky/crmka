"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  clientId: string
  name: string
  direction: string
  recalcCount: number
  recalcAmount: number
  absenceCount: number
  absenceAmount: number
}

export default function AbsenceLossesReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/absence-losses")
  const num = (k: string) => Number((metadata as Record<string, unknown> | null)?.[k] ?? 0)

  return (
    <ReportShell
      title="Отсутствие учеников / потери выручки"
      subtitle="Перерасчёты (потерянная выручка) и прогулы со списанием по ученикам за месяц"
      pageKey="reports/attendance/absence-losses"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Перерасчётов</p>
          <p className="text-2xl font-bold">{num("totalRecalculations")}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Потеряно (перерасчёты)</p>
          <p className="text-2xl font-bold text-red-600">{fmtMoney(num("totalRecalcAmount"))}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Прогулов со списанием</p>
          <p className="text-2xl font-bold">{num("totalAbsences")}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Списано за прогулы</p>
          <p className="text-2xl font-bold">{fmtMoney(num("totalAbsenceAmount"))}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ученик</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead className="text-right">Перерасчётов</TableHead>
                  <TableHead className="text-right">Потери</TableHead>
                  <TableHead className="text-right">Прогулов</TableHead>
                  <TableHead className="text-right">Списано</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.clientId}>
                    <TableCell className="font-medium">
                      <Link href={`/crm/clients/${r.clientId}`} className="hover:underline">{r.name}</Link>
                    </TableCell>
                    <TableCell className="text-sm">{r.direction}</TableCell>
                    <TableCell className="text-right">{r.recalcCount}</TableCell>
                    <TableCell className="text-right text-red-600">{fmtMoney(r.recalcAmount)}</TableCell>
                    <TableCell className="text-right">{r.absenceCount}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.absenceAmount)}</TableCell>
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
