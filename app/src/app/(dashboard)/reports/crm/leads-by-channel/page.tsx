"use client"

import { Card, CardContent } from "@/components/ui/card"
import { ReportShell, ReportStatus, useReportData } from "@/components/report-scaffold"

interface Row {
  channelId: string
  channel: string
  total: number
  perDay: number[]
}

/** Компактная дата для шапки столбца: «дд.мм». */
function fmtDay(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export default function LeadsByChannelReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/leads-by-channel")
  const days = (metadata?.days as string[] | undefined) ?? []
  const totalsPerDay = (metadata?.totalsPerDay as number[] | undefined) ?? []
  const totalLeads = Number(metadata?.totalLeads ?? 0)

  return (
    <ReportShell
      title="Лиды по каналам"
      subtitle="Созданные заявки (лиды) по каналам привлечения и дням месяца"
      pageKey="reports/crm/leads-by-channel"
    >
      <Card>
        <CardContent className="p-0">
          <ReportStatus loading={loading} error={error} empty={data.length === 0} />
          {!loading && !error && data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium whitespace-nowrap">
                      Канал
                    </th>
                    {days.map((d) => (
                      <th
                        key={d}
                        className="px-2 py-2 text-center text-xs font-normal text-muted-foreground whitespace-nowrap"
                      >
                        {fmtDay(d)}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Всего</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.channelId} className="border-t">
                      <td className="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium whitespace-nowrap">
                        {r.channel}
                      </td>
                      {r.perDay.map((v, i) => (
                        <td key={i} className="px-2 py-1.5 text-center tabular-nums">
                          {v === 0 ? "" : v}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-center font-bold tabular-nums">{r.total}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-muted/30 font-bold">
                    <td className="sticky left-0 z-10 bg-muted/30 px-3 py-1.5 whitespace-nowrap">Итого</td>
                    {totalsPerDay.map((v, i) => (
                      <td key={i} className="px-2 py-1.5 text-center tabular-nums">
                        {v === 0 ? "" : v}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-center tabular-nums">{totalLeads}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
