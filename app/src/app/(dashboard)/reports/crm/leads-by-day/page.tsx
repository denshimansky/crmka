"use client"

import { Card, CardContent } from "@/components/ui/card"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"
import { StickyHScroll } from "@/components/sticky-h-scroll"

interface Row {
  date: string
  total: number
  byChannel: Record<string, number>
}

/** Компактная дата для шапки столбца: «дд.мм». */
function fmtDay(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export default function LeadsByDayReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/leads-by-day")
  const totalLeads = Number(metadata?.totalLeads ?? 0)

  return (
    <ReportShell
      title="Лиды по дням"
      subtitle="Новые лиды (вошедшие в воронку) по дням месяца"
      pageKey="reports/crm/leads-by-day"
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
                        Показатель
                      </th>
                      {data.map((r) => (
                        <th
                          key={r.date}
                          className="px-2 py-2 text-center text-xs font-normal text-muted-foreground whitespace-nowrap"
                        >
                          {fmtDay(r.date)}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Итого</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium whitespace-nowrap">
                        Создано лидов
                      </td>
                      {data.map((r) => (
                        <td key={r.date} className="px-2 py-1.5 text-center tabular-nums">
                          {r.total === 0 ? "" : r.total}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-center font-bold tabular-nums">{totalLeads}</td>
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
