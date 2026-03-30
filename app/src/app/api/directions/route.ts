import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  name: z.string().min(1),
  lessonPrice: z.number().min(0),
  lessonDuration: z.number().min(15).max(480).default(45),
  trialPrice: z.number().min(0).optional(),
  trialFree: z.boolean().default(false),
  color: z.string().optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const directions = await db.direction.findMany({
    where: { tenantId: session.user.tenantId, deletedAt: null },
    orderBy: { sortOrder: "asc" },
  })

  return NextResponse.json(directions)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const data = createSchema.parse(body)

  const direction = await db.direction.create({
    data: {
      tenantId: session.user.tenantId,
      name: data.name,
      lessonPrice: data.lessonPrice,
      lessonDuration: data.lessonDuration,
      trialPrice: data.trialPrice,
      trialFree: data.trialFree,
      color: data.color,
    },
  })

  return NextResponse.json(direction, { status: 201 })
}
