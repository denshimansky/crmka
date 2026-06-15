"use client"

import { Card, CardContent } from "@/components/ui/card"
import { ReportShell, ReportStatus, useReportObject, fmtMoney } from "@/components/report-scaffold"

interface Data {
  newClients: { count: number; income: number }
  churnedClients: { count: number; lostRevenueCurrent: number; lostRevenueNextMonth: number }
}

export default function NewClientIncomeReportPage() {
  const { loading, error, data } = useReportObject<Data>("/api/reports/new-client-income")

  return (
    <ReportShell
      title="Доход от новых / упущенный по выбывшим"
      subtitle="Новые клиенты и их доход против выбывших и упущенной выручки за месяц"
      pageKey="reports/finance/new-client-income"
    >
      <ReportStatus loading={loading} error={error} empty={!data} />
      {!loading && !error && data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-semibold text-green-600">Новые клиенты</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Количество новых</span>
                <span className="font-medium">{data.newClients.count}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Доход от новых (отработано)</span>
                <span className="font-bold text-green-600">{fmtMoney(data.newClients.income)}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-semibold text-red-600">Выбывшие клиенты</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Количество выбывших</span>
                <span className="font-medium">{data.churnedClients.count}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Упущено в текущем месяце</span>
                <span className="font-bold text-red-600">{fmtMoney(data.churnedClients.lostRevenueCurrent)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Упущено в следующем (прогноз)</span>
                <span className="font-medium text-orange-600">{fmtMoney(data.churnedClients.lostRevenueNextMonth)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </ReportShell>
  )
}
