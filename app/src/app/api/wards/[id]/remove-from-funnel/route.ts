import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// «Удалить» из контекстного меню /crm/sales — выводит подопечного из воронки:
// salesStage='none', все scheduled TrialLesson отменяются, активные Application
// помечаются soft-deleted. Прошедшие пробные (attended/no_show) не трогаем — это история.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId
  const now = new Date()

  const ward = await db.ward.findFirst({
    where: { id, tenantId },
    select: { id: true, salesStage: true },
  })
  if (!ward) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })

  const result = await db.$transaction(async (tx) => {
    // 1. Отменить все scheduled пробные.
    const cancelledTrials = await tx.trialLesson.updateMany({
      where: { tenantId, wardId: id, status: "scheduled" },
      data: { status: "cancelled" },
    })

    // 2. Удалить (soft) активные заявки.
    const cancelledApps = await tx.application.updateMany({
      where: { tenantId, wardId: id, status: "active", deletedAt: null },
      data: { deletedAt: now },
    })

    // 3. Закрыть автозадачи-напоминания о пробном (они стали фантомами).
    await tx.task.updateMany({
      where: {
        tenantId,
        autoTrigger: { in: ["trial_reminder", "payment_due"] },
        status: "pending",
        deletedAt: null,
        client: { wards: { some: { id } } },
      },
      data: {
        status: "completed",
        completedAt: now,
        completedBy: session.user.employeeId ?? undefined,
      },
    })

    // 4. Вывести подопечного из воронки.
    const updated = await tx.ward.update({
      where: { id },
      data: { salesStage: "none", salesStageAt: now },
    })

    return {
      cancelledTrials: cancelledTrials.count,
      cancelledApps: cancelledApps.count,
      salesStage: updated.salesStage,
    }
  })

  if (session.user.employeeId) {
    await db.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "update",
        entityType: "Ward",
        entityId: id,
        changes: {
          salesStage: { old: ward.salesStage, new: "none" },
          removedFromFunnel: {
            cancelledTrials: result.cancelledTrials,
            cancelledApplications: result.cancelledApps,
          },
        },
      },
    })
  }

  return NextResponse.json({ ok: true, ...result })
}
