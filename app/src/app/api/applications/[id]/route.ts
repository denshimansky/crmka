import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { logClientNote } from "@/lib/communications/log-note"
import { recomputeClientFirstPaidLessonDate } from "@/lib/services/client-first-paid-lesson-date"
import { removeApplicationFromFunnel } from "@/lib/services/remove-application-from-funnel"

const updateSchema = z.object({
  branchId: z.string().uuid().optional(),
  directionId: z.string().uuid().optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).optional(),
  // Дата первого платного занятия ПО ЭТОЙ заявке (per-ребёнок). null = очистить.
  firstPaidLessonDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата формата YYYY-MM-DD"), z.null()])
    .optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const existing = await db.application.findFirst({
    where: { id, tenantId, deletedAt: null },
    include: { direction: { select: { name: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 })
  // Филиал/направление обработанной заявки менять нельзя (они уже влияли на
  // зачисление и downstream). А комментарий — это заметки, его правят и после
  // обработки (например, на вкладках «Пробное»/«Ожидаем оплату»).
  const editsBranchOrDirection = data.branchId !== undefined || data.directionId !== undefined
  if (editsBranchOrDirection && existing.status !== "active") {
    return NextResponse.json({ error: "Обработанную заявку редактировать нельзя" }, { status: 400 })
  }

  if (data.branchId) {
    const br = await db.branch.findFirst({ where: { id: data.branchId, tenantId, deletedAt: null }, select: { id: true } })
    if (!br) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })
  }
  if (data.directionId) {
    const dir = await db.direction.findFirst({ where: { id: data.directionId, tenantId, deletedAt: null }, select: { id: true } })
    if (!dir) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })
  }

  const firstPaid =
    data.firstPaidLessonDate !== undefined
      ? data.firstPaidLessonDate
        ? new Date(data.firstPaidLessonDate)
        : null
      : undefined

  const application = await db.$transaction(async (tx) => {
    const updated = await tx.application.update({
      where: { id },
      data: {
        ...(data.branchId !== undefined && { branchId: data.branchId }),
        ...(data.directionId !== undefined && { directionId: data.directionId }),
        ...(data.comment !== undefined && { comment: data.comment }),
        ...(firstPaid !== undefined && { firstPaidLessonDate: firstPaid }),
      },
    })
    // Дата живёт на заявке (per-ребёнок), но Client.firstPaidLessonDate —
    // агрегат для отчётов: пересчитываем по min из заявок и первого платного.
    if (firstPaid !== undefined) {
      await recomputeClientFirstPaidLessonDate(tx, tenantId, existing.clientId)
    }
    // Правка комментария заявки → заметка в ленту коммуникаций клиента (баг #117):
    // «откуда» (заявка + направление), «когда» (createdAt), «кто» (employeeId).
    // Раньше правку молча писали только в Application.comment + AuditLog, и в
    // ленте новый текст не появлялся (создание — логировалось, правка — нет).
    if (data.comment !== undefined) {
      const oldC = existing.comment?.trim() || ""
      const newC = data.comment?.trim() || ""
      if (oldC !== newC) {
        const dirName = existing.direction?.name || "заявка"
        const content = !oldC
          ? `Комментарий к заявке «${dirName}» добавлен:\n${newC}`
          : !newC
            ? `Комментарий к заявке «${dirName}» удалён:\n«${oldC}»`
            : `Комментарий к заявке «${dirName}» изменён:\n«${oldC}»\n→ «${newC}»`
        await logClientNote(tx, {
          tenantId,
          clientId: existing.clientId,
          content,
          employeeId: session.user.employeeId,
        })
      }
    }
    return updated
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
          ...(data.branchId && existing.branchId !== data.branchId && { branchId: { old: existing.branchId, new: data.branchId } }),
          ...(data.directionId && existing.directionId !== data.directionId && { directionId: { old: existing.directionId, new: data.directionId } }),
          ...(data.comment !== undefined && existing.comment !== data.comment && { comment: { old: existing.comment, new: data.comment } }),
          ...(firstPaid !== undefined && { firstPaidLessonDate: { new: data.firstPaidLessonDate } }),
        },
      },
    })
  }

  return NextResponse.json(application)
}

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
    select: { id: true, wardId: true, clientId: true, stage: true },
  })
  if (!existing) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 })

  // Удаление заявки = вывод из воронки: отменяем её запланированные пробные,
  // пересчитываем этап ребёнка и закрываем фантомные напоминания (баг #43/#46).
  const result = await db.$transaction((tx) =>
    removeApplicationFromFunnel(tx, {
      tenantId,
      applicationId: id,
      wardId: existing.wardId,
      clientId: existing.clientId,
      employeeId: session.user.employeeId,
    }),
  )

  if (session.user.employeeId) {
    await db.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "delete",
        entityType: "Application",
        entityId: id,
        changes: {
          removedFromFunnel: {
            cancelledTrials: result.cancelledTrials,
            deletedSubscriptions: result.deletedSubscriptions,
            stage: existing.stage,
          },
        },
      },
    })
  }

  return NextResponse.json({ ok: true, ...result })
}
