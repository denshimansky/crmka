import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export interface ReportSession {
  tenantId: string
  employeeId: string
  role: string
}

export interface DateRange {
  dateFrom: Date
  dateTo: Date
}

export interface ReportContext {
  session: ReportSession
  dateRange: DateRange
  searchParams: URLSearchParams
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

  return {
    ctx: {
      session: {
        tenantId: user.tenantId,
        employeeId: user.employeeId,
        role: user.role,
      },
      dateRange: { dateFrom, dateTo },
      searchParams,
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
