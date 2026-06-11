import { NextRequest, NextResponse } from "next/server"
import { getReportContext } from "@/lib/report-helpers"
import { computeSalesFunnel, summarizeSalesFunnel } from "@/lib/reports/sales-funnel"

// CRM-13 «Воронка продаж» — тонкая обёртка над общей логикой
// (lib/reports/sales-funnel.ts), чтобы API не расходился со страницей
// /reports/crm/funnel и виджетом дашборда. Месяц берётся из dateFrom.
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, scope } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  const data = await computeSalesFunnel(tenantId, year, month, {
    withRows: false,
    scope,
  })
  const summary = summarizeSalesFunnel(data)

  return NextResponse.json({
    data: {
      funnel: summary.map((s) => ({ status: s.key, label: s.label, count: s.count })),
      tabs: {
        new: data.new.map((s) => ({
          scheme: s.key,
          stages: s.stages.map(({ key, current, carryover }) => ({ key, current, carryover })),
        })),
        existing: data.existing.map((s) => ({
          scheme: s.key,
          stages: s.stages.map(({ key, current, carryover }) => ({ key, current, carryover })),
        })),
      },
    },
    metadata: {
      year,
      month,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
