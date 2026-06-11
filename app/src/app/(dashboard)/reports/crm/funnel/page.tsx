import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { computeSalesFunnel, summarizeSalesFunnel } from "@/lib/reports/sales-funnel"
import { branchScopeFromSession } from "@/lib/branch-scope"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { SalesFunnelReport } from "./funnel-report"

// CRM-13 «Воронка продаж»: событийная воронка по заявкам за месяц.
// Вкладки «новые»/«действующие», схемы «с пробным»/«без», разрезы
// «текущий месяц»/«перетекающие», клик по этапу — детализация.
export default async function FunnelReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const role = session.user.role

  const { year, month } = getMonthFromParams(await searchParams)
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

  // ADM-04: сотрудник с ограничением по филиалам видит только свои заявки/лидов.
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  const data = await computeSalesFunnel(tenantId, year, month, { scope })

  // Телефоны в детализации — по политике видимости (инструктор не видит).
  for (const tab of [data.new, data.existing]) {
    for (const scheme of tab) {
      for (const stage of scheme.stages) {
        for (const row of stage.rows) {
          row.phone = maskPhone(row.phone, role)
        }
      }
    }
  }

  const summary = summarizeSalesFunnel(data)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Воронка продаж</h1>
            <PageHelp pageKey="reports/crm/funnel" />
          </div>
          <p className="text-sm text-muted-foreground">
            Заявки по этапам: лид → заявка → пробное → покупка
          </p>
        </div>
        <MonthPicker />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      {/* Суммарные цифры месяца (текущие + перетекающие) */}
      <div className="grid gap-4 sm:grid-cols-5">
        {summary.map((s) => (
          <Card key={s.key}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold">{s.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <SalesFunnelReport data={data} />
    </div>
  )
}
