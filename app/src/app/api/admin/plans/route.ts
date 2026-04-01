import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { z } from "zod"

// GET /api/admin/plans — список тарифных планов
export async function GET() {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const plans = await db.billingPlan.findMany({
    include: { _count: { select: { subscriptions: true } } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(plans)
}

const createSchema = z.object({
  name: z.string({ required_error: "Название обязательно" }).min(1, "Название обязательно"),
  pricePerBranch: z.number({ required_error: "Цена обязательна" }).min(0, "Цена не может быть отрицательной"),
  description: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

// POST /api/admin/plans — создать тарифный план
export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const plan = await db.billingPlan.create({
    data: {
      name: parsed.data.name,
      pricePerBranch: parsed.data.pricePerBranch,
      description: parsed.data.description,
    },
  })

  return NextResponse.json(plan, { status: 201 })
}
