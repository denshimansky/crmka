import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { z } from "zod"
import { payFromBalance, PayFromBalanceError } from "@/lib/subscriptions/pay-from-balance"
import { logAudit } from "@/lib/audit"

export const runtime = "nodejs"

const schema = z.object({
  amount: z.number().positive(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role === "readonly" || role === "instructor") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? "Некорректный запрос" },
      { status: 400 },
    )
  }

  try {
    const result = await payFromBalance({
      tenantId: session.user.tenantId,
      subscriptionId: id,
      amount: parsed.data.amount,
      createdBy: session.user.employeeId ?? null,
    })
    logAudit({
      tenantId: session.user.tenantId,
      employeeId: session.user.employeeId,
      action: "update",
      entityType: "Subscription",
      entityId: result.subscriptionId,
      changes: {
        operation: { new: "pay_from_balance" },
        amount: { new: result.amount },
        paymentId: { new: result.paymentId },
        becameActive: { new: result.becameActive },
      },
      req,
    })
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof PayFromBalanceError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus })
    }
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
