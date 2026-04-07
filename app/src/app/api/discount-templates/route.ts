import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  type: z.enum(["permanent", "one_time", "linked"]),
  valueType: z.enum(["percent", "fixed"]),
  value: z.number().min(0, "Значение не может быть отрицательным"),
  isStackable: z.boolean().default(false),
  isActive: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const isActive = searchParams.get("isActive")
  const type = searchParams.get("type")

  const where: any = {
    tenantId: session.user.tenantId,
  }

  if (isActive !== null) where.isActive = isActive === "true"
  if (type) where.type = type

  const items = await db.discountTemplate.findMany({
    where,
    orderBy: { createdAt: "desc" },
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
      type: data.type,
      valueType: data.valueType,
      value: data.value,
      isStackable: data.isStackable,
      isActive: data.isActive,
    },
  })

  return NextResponse.json(item, { status: 201 })
}
