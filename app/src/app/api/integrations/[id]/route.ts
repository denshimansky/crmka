import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  config: z.record(z.any()).optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const existing = await db.integrationConfig.findFirst({
    where: { id, tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Интеграция не найдена" }, { status: 404 })

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const integration = await db.integrationConfig.update({
    where: { id },
    data: {
      ...(parsed.data.config !== undefined && { config: parsed.data.config }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    },
  })

  return NextResponse.json(integration)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const existing = await db.integrationConfig.findFirst({
    where: { id, tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Интеграция не найдена" }, { status: 404 })

  await db.integrationConfig.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
