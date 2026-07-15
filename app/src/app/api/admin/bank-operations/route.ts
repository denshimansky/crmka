import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"

// GET /api/admin/bank-operations?status=unmatched — операции выписки Т-Банк.
// Несматченные платежи — очередь на ручную разборку (частичная оплата,
// платёж с чужого юрлица): суперадмин находит счёт и отмечает «Оплачен».
export async function GET(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")

  const operations = await db.billingBankOperation.findMany({
    where: status === "matched" || status === "unmatched" ? { status } : {},
    orderBy: { operationDate: "desc" },
    take: 100,
  })

  return NextResponse.json(operations)
}
