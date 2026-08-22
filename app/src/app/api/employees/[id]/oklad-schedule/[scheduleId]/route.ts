import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { logAudit } from "@/lib/audit"
import { getOkladCategoryId } from "@/lib/salary/oklad-category"
import { resyncOkladTwinsFromMonth } from "@/lib/salary/sync-oklad-twin"

// Удаление версии оклада — мягкое (как у версий сдельной ставки). После удаления
// месяцы с даты версии снова считаются предыдущей суммой, поэтому оклад-твины ОПИУ
// этих периодов пересобираются.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; scheduleId: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }
  const { id, scheduleId } = await params
  const tenantId = session.user.tenantId
  const actor = session.user.employeeId ?? null

  const existing = await db.okladSchedule.findFirst({
    where: { id: scheduleId, employeeId: id, tenantId, deletedAt: null },
    select: { id: true, effectiveFrom: true, amount: true },
  })
  if (!existing) return NextResponse.json({ error: "Изменение оклада не найдено" }, { status: 404 })

  const okladCategoryId = await getOkladCategoryId()
  await db.$transaction(async (tx) => {
    await tx.okladSchedule.update({ where: { id: scheduleId }, data: { deletedAt: new Date() } })
    await resyncOkladTwinsFromMonth(tx, {
      tenantId,
      employeeId: id,
      fromYear: existing.effectiveFrom.getUTCFullYear(),
      fromMonth: existing.effectiveFrom.getUTCMonth() + 1,
      okladCategoryId,
      createdBy: actor,
    })
  })

  logAudit({
    tenantId,
    employeeId: actor,
    action: "delete",
    entityType: "OkladSchedule",
    entityId: scheduleId,
    changes: {
      amount: { old: Number(existing.amount) },
      effectiveFrom: { old: existing.effectiveFrom.toISOString().slice(0, 10) },
    },
    req,
  })
  return NextResponse.json({ ok: true })
}
