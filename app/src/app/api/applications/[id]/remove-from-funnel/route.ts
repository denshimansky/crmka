import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"

// «Удалить» из контекстного меню /crm/sales — выводит из воронки ОДНУ заявку
// (строку «Продаж»): её не-отменённые пробные отменяются, сама заявка помечается
// soft-deleted. Остальные заявки ребёнка остаются в воронке. Прошедшие пробные
// (attended/no_show) не трогаем — это история; отменяем только запланированные.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId
  const now = new Date()

  const application = await db.application.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true, wardId: true, clientId: true, stage: true },
  })
  if (!application) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 })

  const result = await db.$transaction(async (tx) => {
    // 1. Отменить запланированные пробные этой заявки.
    const cancelledTrials = await tx.trialLesson.updateMany({
      where: { tenantId, applicationId: id, status: "scheduled" },
      data: { status: "cancelled" },
    })

    // 2. Soft-delete самой заявки.
    await tx.application.update({
      where: { id },
      data: { deletedAt: now, status: "processed" },
    })

    // 3. Если у клиента не осталось будущих запланированных пробных — закрыть
    //    автозадачи-напоминания (иначе они станут фантомными).
    const remainingScheduled = await tx.trialLesson.count({
      where: { tenantId, clientId: application.clientId, status: "scheduled" },
    })
    if (remainingScheduled === 0) {
      await tx.task.updateMany({
        where: {
          tenantId,
          clientId: application.clientId,
          autoTrigger: "trial_reminder",
          status: "pending",
          deletedAt: null,
        },
        data: {
          status: "completed",
          completedAt: now,
          completedBy: session.user.employeeId ?? undefined,
        },
      })
    }

    // 4. Пересчитать зеркало Ward.salesStage по оставшимся активным заявкам.
    await recomputeWardSalesStage(tx, tenantId, application.wardId, now)

    return { cancelledTrials: cancelledTrials.count }
  })

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
