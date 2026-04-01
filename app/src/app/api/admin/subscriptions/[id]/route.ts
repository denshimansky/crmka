import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { z } from "zod"

// PATCH /api/admin/subscriptions/[id] — обновить подписку
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  const schema = z.object({
    status: z.enum(["active", "grace_period", "blocked", "cancelled"]).optional(),
    branchCount: z.number().int().min(1).optional(),
    planId: z.string().uuid().optional(),
    nextPaymentDate: z.string().optional(),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.billingSubscription.findUnique({
    where: { id },
    include: { plan: true },
  })
  if (!existing) {
    return NextResponse.json({ error: "Подписка не найдена" }, { status: 404 })
  }

  const data: Record<string, unknown> = {}

  if (parsed.data.status) {
    data.status = parsed.data.status
    // Синхронизируем billingStatus организации
    const orgStatus = parsed.data.status === "cancelled" ? "blocked" : parsed.data.status
    await db.organization.update({
      where: { id: existing.organizationId },
      data: { billingStatus: orgStatus as "active" | "grace_period" | "blocked" },
    })
    if (parsed.data.status === "blocked") {
      data.blockedAt = new Date()
    }
  }

  if (parsed.data.branchCount) {
    data.branchCount = parsed.data.branchCount
    const plan = parsed.data.planId
      ? await db.billingPlan.findUnique({ where: { id: parsed.data.planId } })
      : existing.plan
    if (plan) {
      data.monthlyAmount = Number(plan.pricePerBranch) * parsed.data.branchCount
    }
  }

  if (parsed.data.planId) data.planId = parsed.data.planId
  if (parsed.data.nextPaymentDate) data.nextPaymentDate = new Date(parsed.data.nextPaymentDate)

  const updated = await db.billingSubscription.update({
    where: { id },
    data,
    include: {
      organization: { select: { name: true } },
      plan: { select: { name: true } },
    },
  })

  return NextResponse.json(updated)
}
