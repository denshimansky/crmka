"use client"

import { Card, CardContent } from "@/components/ui/card"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"
import { StickyHScroll } from "@/components/sticky-h-scroll"

interface Row {
  channelId: string
  channel: string
  budget: number
  leads: number
  clients: number
  revenue: number
  costPerLead: number
  costPerClient: number
  conversion: number
  romi: number | null
}

interface Totals {
  budget: number
  leads: number
  clients: number
  revenue: number
  costPerLead: number
  costPerClient: number
  conversion: number
  romi: number | null
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const romiFmt = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v)}%`)
const romiClass = (v: number | null) =>
  v === null
    ? "text-muted-foreground"
    : v >= 0
      ? "text-green-600 dark:text-green-400"
      : "text-red-600 dark:text-red-400"

export default function RomiReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/romi")
  const avgCheck = Number(metadata?.avgCheck ?? 0)
  const totals = (metadata?.totals as Totals | undefined) ?? null

  return (
    <ReportShell
      title="Эффективность рекламы (ROMI)"
      subtitle="Бюджет, лиды, новые клиенты, выручка и ROMI по каналам привлечения за месяц"
      pageKey="reports/crm/romi"
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
                      <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium whitespace-nowrap">Канал</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Бюджет</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Лид</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Стоим. лида</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Клиентов</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Стоим. клиента</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Конверсия</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Ср. чек</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Выручка</th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">ROMI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((r) => (
                      <tr key={r.channelId} className="border-t">
                        <td className="sticky left-0 z-10 bg-background px-3 py-1.5 font-medium whitespace-nowrap">{r.channel}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.budget ? fmtMoney(r.budget) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.leads || ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.leads && r.budget ? fmtMoney(r.costPerLead) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.clients || ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.clients && r.budget ? fmtMoney(r.costPerClient) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.leads ? pct(r.conversion) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtMoney(avgCheck)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.revenue ? fmtMoney(r.revenue) : ""}</td>
                        <td className={"px-3 py-1.5 text-right font-medium tabular-nums " + romiClass(r.romi)}>{romiFmt(r.romi)}</td>
                      </tr>
                    ))}
                    {totals && (
                      <tr className="border-t-2 bg-muted/30 font-bold">
                        <td className="sticky left-0 z-10 bg-muted/30 px-3 py-1.5 whitespace-nowrap">Итого</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(totals.budget)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{totals.leads || ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{totals.leads && totals.budget ? fmtMoney(totals.costPerLead) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{totals.clients || ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{totals.clients && totals.budget ? fmtMoney(totals.costPerClient) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{totals.leads ? pct(totals.conversion) : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtMoney(avgCheck)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(totals.revenue)}</td>
                        <td className={"px-3 py-1.5 text-right tabular-nums " + romiClass(totals.romi)}>{romiFmt(totals.romi)}</td>
                      </tr>
                    )}
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
