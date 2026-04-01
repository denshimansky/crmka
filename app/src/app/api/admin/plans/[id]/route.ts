import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { z } from "zod"

// PATCH /api/admin/plans/[id] — обновить план
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  const schema = z.object({
    name: z.string().min(1).optional(),
    pricePerBranch: z.number().min(0).optional(),
    description: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
    isActive: z.boolean().optional(),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) data.name = parsed.data.name
  if (parsed.data.pricePerBranch !== undefined) data.pricePerBranch = parsed.data.pricePerBranch
  if (parsed.data.description !== undefined) data.description = parsed.data.description
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive

  const plan = await db.billingPlan.update({ where: { id }, data })
  return NextResponse.json(plan)
}

// DELETE /api/admin/plans/[id] — деактивировать план
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const plan = await db.billingPlan.update({
    where: { id },
    data: { isActive: false },
  })

  return NextResponse.json(plan)
}
