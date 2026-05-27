import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { logAudit, diffChanges } from "@/lib/audit"
import { z } from "zod"

const schema = z.object({
  hidePhonesFromInstructors: z.boolean().optional(),
  restrictClientExport: z.boolean().optional(),
})

/**
 * PATCH /api/organization/security — Ф6.1
 * Меняет флаги «скрывать телефоны у инструктора» и «запрет выгрузки базы».
 * Доступно только владельцу.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (session.user.role !== "owner") {
    return NextResponse.json(
      { error: "Только владелец может менять настройки безопасности" },
      { status: 403 },
    )
  }

  const tenantId = session.user.tenantId
  const employeeId = session.user.employeeId

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }
  const data = parsed.data

  const existing = await db.organization.findUnique({
    where: { id: tenantId },
    select: { hidePhonesFromInstructors: true, restrictClientExport: true },
  })
  if (!existing) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })

  const updateData: Record<string, unknown> = {}
  if (data.hidePhonesFromInstructors !== undefined) {
    updateData.hidePhonesFromInstructors = data.hidePhonesFromInstructors
  }
  if (data.restrictClientExport !== undefined) {
    updateData.restrictClientExport = data.restrictClientExport
  }

  const updated = await db.organization.update({
    where: { id: tenantId },
    data: updateData,
    select: { hidePhonesFromInstructors: true, restrictClientExport: true },
  })

  const changes = diffChanges(existing, updated, ["hidePhonesFromInstructors", "restrictClientExport"])
  if (changes) {
    logAudit({
      tenantId,
      employeeId,
      action: "update",
      entityType: "Organization",
      entityId: tenantId,
      changes,
      req,
    })
  }

  return NextResponse.json(updated)
}
