"use client"

import { Card, CardContent } from "@/components/ui/card"
import { ReportShell, ReportStatus, useReportObject, fmtMoney } from "@/components/report-scaffold"

interface Forecast {
  subscriptionAmount: number
  salaryForecast: number
  variableExpensesForecast: number
  fixedExpensesForecast: number
  profitForecast: number
}

export default function ProfitForecastReportPage() {
  const { loading, error, data } = useReportObject<Forecast>("/api/reports/profit-forecast")

  const lines = data
    ? [
        { label: "Сумма абонементов (план выручки)", value: data.subscriptionAmount, sign: "+" as const },
        { label: "Прогноз ЗП педагогов", value: data.salaryForecast, sign: "−" as const },
        { label: "Переменные расходы (среднее за 3 мес)", value: data.variableExpensesForecast, sign: "−" as const },
        { label: "Постоянные расходы", value: data.fixedExpensesForecast, sign: "−" as const },
      ]
    : []

  return (
    <ReportShell
      title="Прогноз прибыли"
      subtitle="Сумма абонементов − ЗП − переменные − постоянные расходы (на текущий месяц)"
      pageKey="reports/finance/profit-forecast"
    >
      <Card>
        <CardContent className="p-4">
          <ReportStatus loading={loading} error={error} empty={!data} />
          {!loading && !error && data && (
            <div className="space-y-2">
              {lines.map((l) => (
                <div key={l.label} className="flex items-center justify-between border-b py-2 text-sm">
                  <span className="text-muted-foreground">
                    <span className="mr-2 font-mono">{l.sign}</span>
                    {l.label}
                  </span>
                  <span className="font-medium">{fmtMoney(l.value)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3">
                <span className="text-base font-semibold">Прогноз прибыли</span>
                <span
                  className={`text-2xl font-bold ${data.profitForecast >= 0 ? "text-green-600" : "text-red-600"}`}
                >
                  {fmtMoney(data.profitForecast)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </ReportShell>
  )
}
