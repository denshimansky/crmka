import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId

  const existing = await db.application.findFirst({
    where: { id, tenantId, deletedAt: null },
  })
  if (!existing) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 })

  await db.application.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  if (session.user.employeeId) {
    await db.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "delete",
        entityType: "Application",
        entityId: id,
      },
    })
  }

  return NextResponse.json({ ok: true })
}
