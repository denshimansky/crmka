import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { logAudit } from "@/lib/audit"
import { branchScopeFromSession, canAccessBranch } from "@/lib/branch-scope"
import { restoreDeletedLesson } from "@/lib/schedule/deleted-lessons"

// POST /api/deleted-lessons/[id]/restore — вернуть удалённое занятие в расписание.
// [id] — строка архива (deleted_lessons), а не прежний id занятия: занятие
// пересоздаётся с новым id.
//
// Права зеркалят удаление (DELETE /api/lessons/[id]): owner/manager/admin, свой
// филиал, открытый период. Инструктор восстанавливать не может — удалять он тоже
// не может.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = session.user.role
  if (role !== "owner" && role !== "manager" && role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const tenantId = session.user.tenantId
  const employeeId = session.user.employeeId

  const row = await db.deletedLesson.findFirst({
    where: { id, tenantId },
    select: { id: true, date: true, group: { select: { branchId: true } } },
  })
  if (!row) return NextResponse.json({ error: "Запись об удалении не найдена" }, { status: 404 })

  if (!canAccessBranch(row.group.branchId, branchScopeFromSession(session.user.allowedBranchIds))) {
    return NextResponse.json({ error: "Нет доступа к филиалу этого занятия" }, { status: 403 })
  }

  const { isPeriodLocked } = await import("@/lib/period-check")
  if (await isPeriodLocked(tenantId, new Date(row.date), role)) {
    return NextResponse.json(
      { error: "Период закрыт. Обратитесь к владельцу или управляющему." },
      { status: 403 },
    )
  }

  const result = await restoreDeletedLesson(db, {
    tenantId,
    deletedLessonId: id,
    restoredBy: employeeId ?? null,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  logAudit({
    tenantId,
    employeeId: employeeId ?? null,
    action: "create",
    entityType: "Lesson",
    entityId: result.lessonId,
    changes: {
      restoredFrom: { new: id },
      date: { new: row.date.toISOString().slice(0, 10) },
    },
    req,
  })

  return NextResponse.json({
    ok: true,
    lessonId: result.lessonId,
    selectionsRestored: result.selectionsRestored,
  })
}
