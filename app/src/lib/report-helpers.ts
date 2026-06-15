import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { branchScopeFromSession, type BranchScope } from "@/lib/branch-scope"

export interface ReportSession {
  tenantId: string
  employeeId: string
  role: string
  // ADM-04: scope филиалов из EmployeeBranch. Используется в WHERE-условиях.
  allowedBranchIds: string[] | null
}

export interface DateRange {
  dateFrom: Date
  dateTo: Date
}

export interface ReportContext {
  session: ReportSession
  dateRange: DateRange
  searchParams: URLSearchParams
  scope: BranchScope
}

/**
 * Extracts and validates report context from request.
 * Returns null + sends error response if auth fails.
 */
export async function getReportContext(
  req: NextRequest
): Promise<{ ctx: ReportContext; error?: never } | { ctx?: never; error: NextResponse }> {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const user = session.user as any
  const { searchParams } = new URL(req.url)

  const dateFromStr = searchParams.get("dateFrom")
  const dateToStr = searchParams.get("dateTo")

  // Default to current month
  const now = new Date()
  const dateFrom = dateFromStr
    ? new Date(dateFromStr)
    : new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  const dateTo = dateToStr
    ? new Date(dateToStr)
    : new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59))

  const allowedBranchIds = (user.allowedBranchIds ?? null) as string[] | null
  return {
    ctx: {
      session: {
        tenantId: user.tenantId,
        employeeId: user.employeeId,
        role: user.role,
        allowedBranchIds,
      },
      dateRange: { dateFrom, dateTo },
      searchParams,
      scope: branchScopeFromSession(allowedBranchIds),
    },
  }
}

/**
 * Safe division — returns 0 when dividing by zero.
 */
export function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

/**
 * Format percentage with 1 decimal place.
 */
export function pct(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 1000) / 10
}

/** Рабочие дни недели по умолчанию, если у филиала не заданы: Пн-Сб (ISO 1..6). */
export const DEFAULT_WORKING_WEEKDAYS = [1, 2, 3, 4, 5, 6]

/** Часы из "HH:MM" (минуты учитываются). Пусто/некорректно → fallback. */
export function parseHmHours(value: string | null | undefined, fallbackHours: number): number {
  if (!value) return fallbackHours
  const [h, m] = value.split(":").map((x) => parseInt(x, 10))
  return (Number.isFinite(h) ? h : fallbackHours) + (Number.isFinite(m) ? m : 0) / 60
}

/**
 * Точное число рабочих дней в диапазоне [from, to] по набору дней недели
 * (ISO: 1=Пн..7=Вс). Считает по календарю, а не пропорцией дней/7 —
 * иначе «рабочих дней месяца» получается дробным.
 *
 * nonWorkingDates — даты "YYYY-MM-DD", помеченные нерабочими в производственном
 * календаре (getNonWorkingDateSet). Исключаются из подсчёта — так максимум часов
 * согласован с генерацией расписания, которая в эти дни занятия не создаёт.
 */
export function countWorkingDays(
  from: Date,
  to: Date,
  workingWeekdays: number[],
  nonWorkingDates?: Set<string>,
): number {
  const set = new Set(workingWeekdays)
  let count = 0
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  while (cursor.getTime() <= end) {
    const dow = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay()
    if (set.has(dow) && !nonWorkingDates?.has(cursor.toISOString().slice(0, 10))) count++
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return count
}
