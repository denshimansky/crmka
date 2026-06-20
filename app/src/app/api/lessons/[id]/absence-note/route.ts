import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { logAudit } from "@/lib/audit"
import {
  branchScopeFromSession,
  canAccessBranch,
  canAccessLessonAsInstructor,
} from "@/lib/branch-scope"

// POST: upsert/удаление свободного комментария оператора к (занятие, ученик).
// Развязан от Attendance — работает в любом состоянии реестра «Пропуски», в т.ч.
// на вкладке «Неотмеченные», где отметки ещё нет. Пустой/пробельный текст удаляет
// заметку. Период-лок НЕ проверяется: заметка — метаданные, не финансовая операция.
const noteSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  wardId: z.any().transform((v) => (typeof v === "string" && v.trim() ? v.trim() : null)),
  comment: z.string().max(1000).nullable().optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId
  const role = (session.user as any).role

  const body = await req.json()
  const parsed = noteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  // Роль «только чтение» комментировать не может (UI это уже скрывает; защищаем API).
  if (role === "readonly") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: {
      id: true,
      instructorId: true,
      substituteInstructorId: true,
      group: { select: { branchId: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // ADM-04: доступ как у отметки посещения — инструктор только к своим занятиям,
  // админ/менеджер с ограниченным scope — только в своих филиалах.
  const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined
  const scope = branchScopeFromSession(allowedBranchIds)
  if (role === "instructor") {
    if (!canAccessLessonAsInstructor(lesson, employeeId)) {
      return NextResponse.json({ error: "Нет доступа к этому занятию" }, { status: 403 })
    }
  } else if (!canAccessBranch(lesson.group.branchId, scope)) {
    return NextResponse.json({ error: "Нет доступа к филиалу этого занятия" }, { status: 403 })
  }

  const clientId = parsed.data.clientId
  const wardId = parsed.data.wardId
  const raw = parsed.data.comment
  const comment = raw && raw.trim() ? raw.trim() : null

  // find-then-write в транзакции — единственная защита от дублей при wardId=NULL
  // (Postgres не считает NULL равными в составном UNIQUE).
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.lessonStudentNote.findFirst({
      where: { tenantId, lessonId, clientId, wardId },
      select: { id: true },
    })
    if (comment === null) {
      if (existing) {
        await tx.lessonStudentNote.delete({ where: { id: existing.id } })
        return { action: "delete" as const, id: existing.id }
      }
      return { action: "noop" as const, id: null }
    }
    if (existing) {
      const updated = await tx.lessonStudentNote.update({
        where: { id: existing.id },
        data: { comment },
      })
      return { action: "update" as const, id: updated.id }
    }
    const created = await tx.lessonStudentNote.create({
      data: { tenantId, lessonId, clientId, wardId, comment, createdBy: employeeId ?? null },
    })
    return { action: "create" as const, id: created.id }
  })

  if (result.action !== "noop" && result.id) {
    logAudit({
      tenantId,
      employeeId,
      action: result.action,
      entityType: "LessonStudentNote",
      entityId: result.id,
      changes: { lessonId: { new: lessonId }, clientId: { new: clientId } },
      req,
    })
  }

  return NextResponse.json({ ok: true })
}
