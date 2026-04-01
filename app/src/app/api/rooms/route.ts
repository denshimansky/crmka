import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const rooms = await db.room.findMany({
    where: { tenantId: session.user.tenantId, deletedAt: null },
    include: { branch: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(rooms)
}

const createSchema = z.object({
  name: z.string({ required_error: "Название обязательно" }).min(1, "Название обязательно"),
  branchId: z.string().uuid("Выберите филиал"),
  capacity: z.number().int().min(1, "Минимум 1").default(15),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const room = await db.room.create({
    data: {
      tenantId: session.user.tenantId,
      branchId: parsed.data.branchId,
      name: parsed.data.name,
      capacity: parsed.data.capacity,
    },
  })

  return NextResponse.json(room, { status: 201 })
}
