"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"

interface Row {
  instructorId: string
  instructorName: string
  direction: string
  scheme: string
  studentsCount: number
  lessonsCount: number
  forecast: number
  paid: number
  remaining: number
}

const SCHEME: Record<string, string> = {
  per_student: "За ученика",
  per_lesson: "За занятие",
  fixed_plus_per_student: "Фикс + ученик",
  percent_of_payments: "% от оплат",
  floating_by_students: "Плавающая",
}

export default function SalaryForecastReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/salary-forecast")
  const num = (k: string) => Number((metadata as Record<string, unknown> | null)?.[k] ?? 0)

  return (
    <ReportShell
      title="Прогноз сдельной оплаты"
      subtitle="Прогноз ЗП сдельных педагогов по ставкам и текущему расписанию"
      pageKey="reports/salary/salary-forecast"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Педагог</TableHead>
                  <TableHead>Направление</TableHead>
                  <TableHead>Схема</TableHead>
                  <TableHead className="text-right">Учеников</TableHead>
                  <TableHead className="text-right">Занятий</TableHead>
                  <TableHead className="text-right">Прогноз</TableHead>
                  <TableHead className="text-right">Выплачено</TableHead>
                  <TableHead className="text-right">К оплате</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r, i) => (
                  <TableRow key={`${r.instructorId}-${i}`}>
                    <TableCell className="font-medium">{r.instructorName}</TableCell>
                    <TableCell className="text-sm">{r.direction}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{SCHEME[r.scheme] || r.scheme}</TableCell>
                    <TableCell className="text-right">{r.studentsCount}</TableCell>
                    <TableCell className="text-right">{r.lessonsCount}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(r.forecast)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtMoney(r.paid)}</TableCell>
                    <TableCell className="text-right font-bold">{fmtMoney(r.remaining)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={5}>Итого</TableCell>
                  <TableCell className="text-right">{fmtMoney(num("totalForecast"))}</TableCell>
                  <TableCell className="text-right">{fmtMoney(num("totalPaid"))}</TableCell>
                  <TableCell className="text-right">{fmtMoney(num("totalForecast") - num("totalPaid"))}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
