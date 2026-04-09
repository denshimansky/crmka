import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

// GET /api/absence-reasons — список причин пропусков
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as any).tenantId

  const reasons = await db.absenceReason.findMany({
    where: { tenantId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })

  return NextResponse.json(reasons)
}

const createSchema = z.object({
  name: z.string().min(1, "Название обязательно").max(100),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

// POST /api/absence-reasons — создать причину
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as any).tenantId
  const body = await request.json()
  const parsed = createSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const reason = await db.absenceReason.create({
    data: {
      tenantId,
      name: parsed.data.name,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
      isSystem: false,
    },
  })

  return NextResponse.json(reason, { status: 201 })
}
