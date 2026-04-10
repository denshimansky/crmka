import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  name: z.string().min(1, "Наименование обязательно"),
  unit: z.string().min(1).default("шт"),
  defaultUnitCost: z.number().min(0).optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const items = await db.stockItem.findMany({
    where: { tenantId: session.user.tenantId, deletedAt: null },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["owner", "manager", "admin"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка" }, { status: 400 })
  }

  const item = await db.stockItem.create({
    data: {
      tenantId: session.user.tenantId,
      name: parsed.data.name,
      unit: parsed.data.unit,
      defaultUnitCost: parsed.data.defaultUnitCost,
    },
  })

  return NextResponse.json(item, { status: 201 })
}
