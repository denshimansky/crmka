import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { removeApplicationFromFunnel } from "@/lib/services/remove-application-from-funnel"

// «Удалить» из контекстного меню /crm/sales — выводит из воронки ОДНУ заявку
// (строку «Продаж»): её не-отменённые пробные отменяются, сама заявка помечается
// soft-deleted. Остальные заявки ребёнка остаются в воронке. Прошедшие пробные
// (attended/no_show) не трогаем — это история; отменяем только запланированные.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  const application = await db.application.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true, wardId: true, clientId: true, stage: true },
  })
  if (!application) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 })

  const result = await db.$transaction((tx) =>
    removeApplicationFromFunnel(tx, {
      tenantId,
      applicationId: id,
      wardId: application.wardId,
      clientId: application.clientId,
      employeeId: session.user.employeeId,
    }),
  )

  if (session.user.employeeId) {
    await db.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "update",
        entityType: "Application",
        entityId: id,
        changes: {
          status: { old: "active", new: "processed" },
          removedFromFunnel: { cancelledTrials: result.cancelledTrials, stage: application.stage },
        },
      },
    })
  }

  return NextResponse.json({ ok: true, ...result })
}
