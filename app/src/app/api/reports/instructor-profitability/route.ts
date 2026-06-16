import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext, safeDivide, pct } from "@/lib/report-helpers"

/** 7.5. Сколько денег приносит педагог */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")

  // Revenue and salary per instructor from attendances
  const attWhere: any = {
    tenantId,
    lesson: { date: { gte: dateFrom, lte: dateTo } },
  }
  if (branchId) attWhere.lesson = { ...attWhere.lesson, group: { branchId } }

  const attendances = await db.attendance.findMany({
    where: attWhere,
    select: {
      chargeAmount: true,
      instructorPayAmount: true,
      instructorPayEnabled: true,
      attendanceType: { select: { countsAsRevenue: true } },
      lesson: {
        select: {
          id: true,
          instructorId: true,
          substituteInstructorId: true,
          instructor: { select: { firstName: true, lastName: true } },
          substituteInstructor: { select: { firstName: true, lastName: true } },
          group: { select: { branchId: true } },
        },
      },
    },
  })

  // Агрегируем по паре (педагог × филиал). Педагог может вести в нескольких
  // филиалах, а расходы каждого филиала распределяются пропорционально выручке
  // (постоянные) и занятиям (переменные) ИМЕННО в этом филиале. Раньше педагог
  // привязывался к одному филиалу (по первому занятию) — его выручка из второго
  // филиала выпадала из знаменателя, и постоянные расходы концентрировались на
  // оставшихся педагогах того филиала.
  type Cell = {
    instrId: string
    name: string
    branchId: string
    revenue: number
    salary: number
    lessons: Set<string>
  }
  const cells = new Map<string, Cell>()

  for (const a of attendances) {
    const iId = a.lesson.substituteInstructorId || a.lesson.instructorId
    const instr = a.lesson.substituteInstructorId && a.lesson.substituteInstructor
      ? a.lesson.substituteInstructor
      : a.lesson.instructor
    const branchId = a.lesson.group.branchId
    const key = `${iId}:${branchId}`
    if (!cells.has(key)) {
      cells.set(key, {
        instrId: iId,
        name: [instr.lastName, instr.firstName].filter(Boolean).join(" "),
        branchId,
        revenue: 0,
        salary: 0,
        lessons: new Set(),
      })
    }
    const d = cells.get(key)!
    if (a.attendanceType.countsAsRevenue) d.revenue += Number(a.chargeAmount)
    if (a.instructorPayEnabled) d.salary += Number(a.instructorPayAmount)
    d.lessons.add(a.lesson.id)
  }

  // Итоги по филиалам — знаменатели для распределения расходов.
  const branchTotalLessons = new Map<string, number>()
  const branchTotalRevenue = new Map<string, number>()
  for (const c of cells.values()) {
    branchTotalLessons.set(c.branchId, (branchTotalLessons.get(c.branchId) || 0) + c.lessons.size)
    branchTotalRevenue.set(c.branchId, (branchTotalRevenue.get(c.branchId) || 0) + c.revenue)
  }

  // Expenses per branch
  const expenses = await db.expense.findMany({
    where: { tenantId, deletedAt: null, date: { gte: dateFrom, lte: dateTo } },
    select: {
      amount: true,
      isVariable: true,
      branches: { select: { branchId: true } },
    },
  })

  const branchVarExp = new Map<string, number>()
  const branchFixExp = new Map<string, number>()
  for (const e of expenses) {
    for (const eb of e.branches) {
      if (eb.branchId) {
        if (e.isVariable) branchVarExp.set(eb.branchId, (branchVarExp.get(eb.branchId) || 0) + Number(e.amount))
        else branchFixExp.set(eb.branchId, (branchFixExp.get(eb.branchId) || 0) + Number(e.amount))
      }
    }
  }

  // Сворачиваем ячейки (педагог × филиал) в строки по педагогу: доля расходов
  // каждого филиала считается отдельно и суммируется.
  type Agg = { name: string; revenue: number; salary: number; varShare: number; fixShare: number }
  const instrAgg = new Map<string, Agg>()
  for (const c of cells.values()) {
    const bLes = branchTotalLessons.get(c.branchId) || 1
    const bRev = branchTotalRevenue.get(c.branchId) || 1
    const varShare = (branchVarExp.get(c.branchId) || 0) * safeDivide(c.lessons.size, bLes)
    const fixShare = (branchFixExp.get(c.branchId) || 0) * safeDivide(c.revenue, bRev)
    const cur = instrAgg.get(c.instrId) || { name: c.name, revenue: 0, salary: 0, varShare: 0, fixShare: 0 }
    cur.revenue += c.revenue
    cur.salary += c.salary
    cur.varShare += varShare
    cur.fixShare += fixShare
    instrAgg.set(c.instrId, cur)
  }

  const totalNetProfit = [...instrAgg.values()].reduce(
    (s, d) => s + (d.revenue - d.salary - d.varShare - d.fixShare),
    0,
  )

  const data = [...instrAgg.entries()]
    .map(([id, d]) => {
      const profitability = d.revenue - d.salary - d.varShare - d.fixShare
      return {
        instructorId: id,
        instructorName: d.name,
        revenue: Math.round(d.revenue),
        salary: Math.round(d.salary),
        variableExpenses: Math.round(d.varShare),
        fixedExpenses: Math.round(d.fixShare),
        profitability: Math.round(profitability),
        percentOfTotal: pct(profitability, totalNetProfit),
      }
    })
    .sort((a, b) => b.profitability - a.profitability)

  return NextResponse.json({
    data,
    metadata: {
      totalNetProfit: Math.round(totalNetProfit),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
