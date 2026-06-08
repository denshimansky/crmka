import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import {
  parseSegmentationConfig,
  type SegmentationConfig,
} from "@/lib/segmentation"

const bodySchema = z.object({
  mode: z.enum(["amount", "months"]),
  thresholds: z.object({
    standard: z.number().min(0),
    regular: z.number().min(0),
    vip: z.number().min(0),
  }),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: { segmentationConfig: true },
  })
  const config = parseSegmentationConfig(org?.segmentationConfig)
  return NextResponse.json({ config })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const { thresholds } = parsed.data
  // Пороги должны идти строго по возрастанию: standard < regular < vip.
  if (!(thresholds.standard < thresholds.regular && thresholds.regular < thresholds.vip)) {
    return NextResponse.json(
      { error: "Пороги должны строго возрастать: Стандартный < Постоянный < VIP" },
      { status: 400 },
    )
  }

  const config: SegmentationConfig = parsed.data
  await db.organization.update({
    where: { id: session.user.tenantId },
    data: { segmentationConfig: config as unknown as Prisma.InputJsonValue },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }
  await db.organization.update({
    where: { id: session.user.tenantId },
    data: { segmentationConfig: Prisma.JsonNull },
  })
  return NextResponse.json({ ok: true })
}
