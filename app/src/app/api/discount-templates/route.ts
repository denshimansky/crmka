import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { ensureSystemDiscountTemplates } from "@/lib/discounts/seed-system-templates"
import { z } from "zod"

const createSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  // Через UI создаются только постоянные. Связанные (linked_*) — системные,
  // создаются автоматически при первом GET, редактируются только через PUT.
  kind: z.enum(["permanent"]).default("permanent"),
  valueType: z.enum(["percent", "fixed"]),
  value: z.number().min(0, "Значение не может быть отрицательным"),
  isActive: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await ensureSystemDiscountTemplates(session.user.tenantId)

  const { searchParams } = new URL(req.url)
  const isActive = searchParams.get("isActive")
  const kind = searchParams.get("kind")

  const where: any = {
    tenantId: session.user.tenantId,
    // Скидки v2: легаси-шаблоны старой логики в списках не показываем
    // (история записей Discount на них остаётся).
    isLegacy: false,
  }

  if (isActive !== null) where.isActive = isActive === "true"
  if (kind) where.kind = kind

  const items = await db.discountTemplate.findMany({
    where,
    orderBy: [{ systemKey: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  })

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const item = await db.discountTemplate.create({
    data: {
      tenantId: session.user.tenantId,
      name: data.name,
      kind: data.kind,
      type: "permanent",
      valueType: data.valueType,
      value: data.value,
      isActive: data.isActive,
    },
  })

  return NextResponse.json(item, { status: 201 })
}
