import { NextRequest, NextResponse } from "next/server"
import { getPortalContext, getClientPayments } from "@/lib/portal-data"

// GET /api/portal/payments?offset= — оплаты клиента (клиентский уровень)
export async function GET(req: NextRequest) {
  const ctx = await getPortalContext()
  if (!ctx.ok) {
    return NextResponse.json({ error: "Forbidden", code: ctx.code }, { status: ctx.status })
  }

  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0)
  const result = await getClientPayments(ctx.session.tenantId, ctx.session.clientId, { offset })
  return NextResponse.json(result)
}
