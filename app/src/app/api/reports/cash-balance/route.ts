import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 5.6. Остаток денег — состояние всех счетов/касс */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, searchParams } = result.ctx
  const { tenantId } = session
  const branchId = searchParams.get("branchId")

  const where: any = { tenantId, deletedAt: null }
  if (branchId) where.branchId = branchId

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
