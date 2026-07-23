"use client"

import { Card, CardContent } from "@/components/ui/card"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { useRoleNames } from "@/components/role-names-provider"

interface Row {
  instructorId: string
  instructorName: string
  totalHours: number
  byDay: Record<string, number>
}

/** Компактная дата для шапки столбца: «дд.мм». */
function fmtDay(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** Часы в ячейке: округление до 0,1; ноль — пусто (столбцов много). */
function fmtHours(v: number): string {
  return v === 0 ? "" : String(Math.round(v * 10) / 10)
}

export default function InstructorHoursReportPage() {
  const roleNames = useRoleNames()
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/instructor-hours")
  const totalHours = Number(metadata?.totalHours ?? 0)

  // Столбцы-дни — объединение всех дней, где хоть у одного инструктора были часы.
  const days = [...new Set(data.flatMap((r) => Object.keys(r.byDay)))].sort()
  // Итог по каждому дню — сумма по всем инструкторам.
  const totalsPerDay = days.map((d) => data.reduce((s, r) => s + (r.byDay[d] ?? 0), 0))

  return (
    <ReportShell
      title="Часы инструкторов по дням"
      subtitle="Отработанные часы за месяц (занятие с хотя бы 1 явкой; 30 мин = 0,5 ч)"
      pageKey="reports/salary/instructor-hours"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <StickyHScroll>
              <div className="overflow-x-auto" data-sticky-scroller="">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium whitespace-nowrap">
                        {roleNames.instructor}
                      </th>
                      {days.map((d) => (
                        <th
                          key={d}
                          className="px-2 py-2 text-center text-xs font-normal text-muted-foreground whitespace-nowrap"
                        >
                          {fmtDay(d)}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Итого</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((r) => (
                      <tr key={r.instructorId} className="border-t">
                        <td className="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium whitespace-nowrap">
                          {r.instructorName}
                        </td>
                        {days.map((d) => (
                          <td key={d} className="px-2 py-1.5 text-center tabular-nums">
                            {fmtHours(r.byDay[d] ?? 0)}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-center font-bold tabular-nums whitespace-nowrap">
                          {Math.round(r.totalHours * 10) / 10} ч
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-muted/30 font-bold">
                      <td className="sticky left-0 z-10 bg-muted/30 px-3 py-1.5 whitespace-nowrap">Итого</td>
                      {totalsPerDay.map((v, i) => (
                        <td key={i} className="px-2 py-1.5 text-center tabular-nums">
                          {fmtHours(v)}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-center tabular-nums whitespace-nowrap">
                        {Math.round(totalHours * 10) / 10} ч
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </StickyHScroll>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
