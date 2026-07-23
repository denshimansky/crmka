import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"
import { computeSalaryForecastBreakdown } from "@/lib/salary/forecast-month"

/**
 * 6.2. Прогноз сдельной оплаты.
 *
 * Единая логика с дашбордом («Прогноз прибыли») — computeSalaryForecastBreakdown:
 * прогноз по РАСПИСАНИЮ месяца (scheduled/completed) и резолву ставки
 * (групповая → личная по направлению → личная дефолтная), все схемы, включая
 * плавающую (брекеты). Здесь оставляем только СДЕЛЬНЫХ инструкторов (окладники —
 * не сдельная оплата, для них прогноз = фикс-оклад).
 */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom } = dateRange

  const year = dateFrom.getUTCFullYear()
  const month = dateFrom.getUTCMonth() + 1

  const { rows: allRows } = await computeSalaryForecastBreakdown(db, tenantId, year, month)
  const rows = allRows.filter((r) => !r.isOklad)

  // Уже выплачено сдельным инструкторам за период (документы выплат).
  const payments = await db.salaryPayment.findMany({
    where: {
      tenantId,
      periodYear: year,
      periodMonth: month,
      employeeId: { in: rows.map((r) => r.instructorId) },
    },
    select: { employeeId: true, amount: true },
  })
  const paidMap = new Map<string, number>()
  for (const p of payments) {
    paidMap.set(p.employeeId, (paidMap.get(p.employeeId) || 0) + Number(p.amount))
  }

  const data = rows
    .map((r) => {
      const paid = paidMap.get(r.instructorId) || 0
      return {
        instructorId: r.instructorId,
        instructorName: r.instructorName,
        direction: r.directionNames.join(", ") || "—",
        scheme: r.scheme ?? "",
        studentsCount: r.studentsCount,
        lessonsCount: r.lessonsCount,
        forecast: r.forecast,
        paid,
        remaining: Math.max(0, r.forecast - paid),
      }
    })
    .sort((a, b) => b.forecast - a.forecast)

  return NextResponse.json({
    data,
    metadata: {
      totalForecast: data.reduce((s, d) => s + d.forecast, 0),
      totalPaid: data.reduce((s, d) => s + d.paid, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateRange.dateTo.toISOString(),
    },
  })
}
