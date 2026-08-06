import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import {
  validateSelectedLessons,
  lockAndVerifySelection,
  SelectionConflictError,
} from "@/lib/subscriptions/subscription-lessons"
import { isPeriodLocked } from "@/lib/period-check"

// Правка набора выбранных занятий существующего пакета (swap, фаза 6b).
// v1-безопасно: удалять можно только НЕотмеченные занятия — чтобы не дублировать
// сложную revert-логику списания (её точка — снятие отметки на самом занятии).

const patchSchema = z.object({
  selectedLessonIds: z.array(z.string().uuid()).min(1),
})

/** Текущий выбор пакета + окно (для пикера правки). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const sub = await db.subscription.findFirst({
    where: { id, tenantId, type: "package", deletedAt: null },
    select: { id: true, groupId: true, startDate: true, expiresAt: true, totalLessons: true },
  })
  if (!sub) return NextResponse.json({ error: "Пакет не найден" }, { status: 404 })

  const rows = await db.subscriptionLesson.findMany({
    where: { tenantId, subscriptionId: id },
    select: { lessonId: true },
  })
  return NextResponse.json({
    lessonIds: rows.map((r) => r.lessonId),
    groupId: sub.groupId,
    windowStart: sub.startDate.toISOString().slice(0, 10),
    windowEnd: sub.expiresAt ? sub.expiresAt.toISOString().slice(0, 10) : null,
    totalLessons: sub.totalLessons,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager" && role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }
  const { id } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const sub = await db.subscription.findFirst({
    where: {
      id,
      tenantId,
      type: "package",
      deletedAt: null,
      status: { in: ["pending", "active"] },
    },
    select: {
      id: true, clientId: true, wardId: true, groupId: true,
      startDate: true, expiresAt: true, totalLessons: true,
    },
  })
  if (!sub) return NextResponse.json({ error: "Пакет не найден или закрыт" }, { status: 404 })

  const group = await db.group.findFirst({
    where: { id: sub.groupId, tenantId },
    select: { maxStudents: true },
  })

  const v = await validateSelectedLessons(db, {
    tenantId,
    groupId: sub.groupId,
    clientId: sub.clientId,
    wardId: sub.wardId,
    maxStudents: group?.maxStudents ?? 15,
    totalLessons: sub.totalLessons,
    windowStart: sub.startDate,
    windowEnd: sub.expiresAt,
    selectedLessonIds: parsed.data.selectedLessonIds,
    excludeSubscriptionId: sub.id,
  })
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status })

  const current = await db.subscriptionLesson.findMany({
    where: { tenantId, subscriptionId: id },
    select: { lessonId: true },
  })
  const currentSet = new Set(current.map((c) => c.lessonId))
  const newSet = new Set(parsed.data.selectedLessonIds)
  const removed = [...currentSet].filter((x) => !newSet.has(x))
  const added = [...newSet].filter((x) => !currentSet.has(x))
  if (removed.length === 0 && added.length === 0) {
    return NextResponse.json({ ok: true, changed: 0 })
  }

  // v1-restrict: удалять из плана можно только занятия без СПИСЫВАЮЩЕЙ отметки
  // (chargeAmount>0) — иначе нужен откат списания (его точка — снятие отметки на
  // занятии). Несписывающие отметки (no_show «Не был», charge=0) откатывать нечего,
  // удаление выбора безопасно.
  if (removed.length > 0) {
    const marked = await db.attendance.findFirst({
      where: {
        tenantId,
        subscriptionId: id,
        lessonId: { in: removed },
        isPending: false,
        chargeAmount: { gt: 0 },
      },
      include: { lesson: { select: { date: true } } },
    })
    if (marked) {
      const d = marked.lesson.date.toLocaleDateString("ru-RU")
      return NextResponse.json(
        {
          error: `На занятии ${d} уже есть отметка. Сначала снимите её (в карточке занятия «Не отмечен»), затем меняйте план пакета.`,
        },
        { status: 409 },
      )
    }
  }

  // Период закрыт для одного из затронутых занятий — не владельцу/управляющему нельзя.
  const affected = await db.lesson.findMany({
    where: { tenantId, id: { in: [...removed, ...added] } },
    select: { date: true },
  })
  for (const l of affected) {
    if (await isPeriodLocked(tenantId, new Date(l.date), role)) {
      return NextResponse.json(
        { error: "Период закрыт для одного из занятий. Обратитесь к владельцу или управляющему." },
        { status: 403 },
      )
    }
  }

  try {
    await db.$transaction(async (tx) => {
      // Под advisory-локом перепроверяем кросс-пакет+вместимость (гонка oversell, #4).
      await lockAndVerifySelection(tx, {
        tenantId,
        groupId: sub.groupId,
        clientId: sub.clientId,
        wardId: sub.wardId,
        maxStudents: group?.maxStudents ?? 15,
        lessonIds: parsed.data.selectedLessonIds,
        excludeSubscriptionId: id,
      })
      if (removed.length > 0) {
        await tx.subscriptionLesson.deleteMany({
          where: { tenantId, subscriptionId: id, lessonId: { in: removed } },
        })
      }
      if (added.length > 0) {
        await tx.subscriptionLesson.createMany({
          data: added.map((lessonId) => ({
            tenantId,
            subscriptionId: id,
            lessonId,
            createdBy: employeeId ?? null,
          })),
        })
      }
    })
  } catch (e) {
    if (e instanceof SelectionConflictError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    throw e
  }

  return NextResponse.json({ ok: true, changed: removed.length + added.length })
}
