"use client"

import { Card, CardContent } from "@/components/ui/card"
import { ReportShell, ReportStatus, useReportData, fmtMoney } from "@/components/report-scaffold"
import { StickyHScroll } from "@/components/sticky-h-scroll"

interface Row {
  date: string
  cash: number
  noncash: number
  total: number
  byAccount: Record<string, number>
}

/** Компактная дата для шапки столбца: «дд.мм». */
function fmtDay(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

/** Сумма в ячейке дня без «₽» (нули не показываем — колонок много). */
function fmtCell(v: number): string {
  return v === 0 ? "" : new Intl.NumberFormat("ru-RU").format(Math.round(v))
}

export default function DailyIncomeReportPage() {
  const { loading, error, data, metadata } = useReportData<Row>("/api/reports/daily-income")
  const totalAmount = Number(metadata?.totalAmount ?? 0)
  const totals = data.reduce(
    (acc, r) => ({ cash: acc.cash + r.cash, noncash: acc.noncash + r.noncash }),
    { cash: 0, noncash: 0 },
  )

  const metrics: { label: string; get: (r: Row) => number; total: number; bold?: boolean }[] = [
    { label: "Наличные", get: (r) => r.cash, total: totals.cash },
    { label: "Безнал", get: (r) => r.noncash, total: totals.noncash },
    { label: "Всего", get: (r) => r.total, total: totalAmount, bold: true },
  ]

  return (
    <ReportShell
      title="Поступления по дням"
      subtitle="Ежедневные поступления от клиентов в разрезе нал/безнал"
      pageKey="reports/finance/daily-income"
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
                    {metrics.map((m) => (
                      <tr key={m.label} className={m.bold ? "border-t-2 bg-muted/30 font-bold" : "border-t"}>
                        <td
                          className={`sticky left-0 z-10 px-3 py-1.5 whitespace-nowrap ${
                            m.bold ? "bg-muted/30 font-bold" : "bg-background font-medium"
                          }`}
                        >
                          {m.label}
                        </td>
                        {data.map((r) => (
                          <td key={r.date} className="px-2 py-1.5 text-right tabular-nums">
                            {fmtCell(m.get(r))}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right font-bold tabular-nums whitespace-nowrap">
                          {fmtMoney(m.total)}
                        </td>
                      </tr>
                    ))}
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
