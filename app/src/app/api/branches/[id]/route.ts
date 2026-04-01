import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  const schema = z.object({
    name: z.string().min(1).optional(),
    address: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
    workingHoursStart: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
    workingHoursEnd: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.name) data.name = parsed.data.name
  if (parsed.data.address !== undefined) data.address = parsed.data.address
  if (parsed.data.workingHoursStart !== undefined) data.workingHoursStart = parsed.data.workingHoursStart
  if (parsed.data.workingHoursEnd !== undefined) data.workingHoursEnd = parsed.data.workingHoursEnd

  const branch = await db.branch.update({
    where: { id, tenantId: session.user.tenantId },
    data,
  })

  return NextResponse.json(branch)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  await db.branch.update({
    where: { id, tenantId: session.user.tenantId },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
