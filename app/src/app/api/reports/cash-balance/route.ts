import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"
import { scopeFinancialAccount } from "@/lib/branch-scope"

/** 5.6. Остаток денег — состояние всех счетов/касс */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, searchParams, scope } = result.ctx
  const { tenantId } = session
  const branchId = searchParams.get("branchId")

  // ADM-04 (23.07.2026): скоуп-админ видит только счета своих филиалов; общие
  // счета (branchId=NULL) — общеорганизационные, скрыты. scopeFinancialAccount
  // уже строгий (branch-only). Явный branchId-параметр НЕ должен обходить scope,
  // поэтому кладём его в AND поверх скоупа, а не перезаписываем branchId.
  const where: any = { tenantId, deletedAt: null, ...scopeFinancialAccount(scope) }
  if (branchId) where.AND = [...(where.AND ?? []), { branchId }]

  const accounts = await db.financialAccount.findMany({
    where,
    select: {
      id: true,
      name: true,
      type: true,
      balance: true,
      isActive: true,
      branch: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  })

  const data = accounts.map((a) => ({
    accountId: a.id,
    accountName: a.name,
    type: a.type,
    balance: Number(a.balance),
    isActive: a.isActive,
    branch: a.branch?.name || null,
  }))

  return NextResponse.json({
    data,
    metadata: {
      totalBalance: data.reduce((s, d) => s + d.balance, 0),
      accountCount: accounts.length,
    },
  })
}
