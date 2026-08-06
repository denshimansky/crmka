// Задача «Перевыбрать занятие пакета» (docs/package-lesson-selection-plan.md, фаза 6a).
// Когда ВЫБРАННОЕ занятие пакета физически удаляется (массовая отмена дня или
// одиночный DELETE занятия), строка SubscriptionLesson исчезает по cascade, а
// totalLessons пакета остаётся прежним → у пакета освобождается «место», но его
// нельзя потратить, пока оператор не выберет новое занятие. Решение владельца №2:
// освободить слот (cascade делает это сам) + создать задачу на перевыбор.

import type { Prisma, PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

export interface DeletedSelectionSnapshot {
  subscriptionId: string
  clientId: string
  wardId: string | null
  lessonDate: Date
}

/**
 * Снимок выборов живых пакетов, привязанных к удаляемым занятиям. Снимать СТРОГО
 * ДО удаления занятий — после cascade строки SubscriptionLesson не найти.
 * Для не-package тенантов вернёт пусто (строк нет).
 */
export async function snapshotPackageSelections(
  db: DB,
  tenantId: string,
  lessonIds: string[],
): Promise<DeletedSelectionSnapshot[]> {
  if (lessonIds.length === 0) return []
  const rows = await db.subscriptionLesson.findMany({
    where: {
      tenantId,
      lessonId: { in: lessonIds },
      subscription: { type: "package", status: { in: ["active", "pending"] }, deletedAt: null },
    },
    select: {
      subscriptionId: true,
      lesson: { select: { date: true } },
      subscription: { select: { clientId: true, wardId: true } },
    },
  })
  return rows.map((r) => ({
    subscriptionId: r.subscriptionId,
    clientId: r.subscription.clientId,
    wardId: r.subscription.wardId,
    lessonDate: r.lesson.date,
  }))
}

/**
 * Создаёт задачи «Перевыбрать занятие пакета» по снимку (идемпотентно по описанию).
 * Вызывать ПОСЛЕ удаления занятий. Возвращает число созданных задач.
 */
export async function createReselectPackageLessonTasks(
  db: DB,
  tenantId: string,
  snapshot: DeletedSelectionSnapshot[],
  createdBy?: string | null,
): Promise<number> {
  if (snapshot.length === 0) return 0

  const assignee = await db.employee.findFirst({
    where: { tenantId, deletedAt: null, isActive: true, role: { in: ["manager", "owner", "admin"] } },
    select: { id: true },
    orderBy: { role: "asc" },
  })
  if (!assignee) return 0

  const clientIds = [...new Set(snapshot.map((s) => s.clientId))]
  const clients = await db.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, firstName: true, lastName: true },
  })
  const nameById = new Map(
    clients.map((c) => [c.id, [c.lastName, c.firstName].filter(Boolean).join(" ") || "Клиент"]),
  )

  const now = new Date()
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  let created = 0
  for (const s of snapshot) {
    const dateLabel = s.lessonDate.toLocaleDateString("ru-RU")
    // subscriptionId в описании — для идемпотентности (один пакет = одна задача).
    const description =
      `Занятие ${dateLabel} отменено — у пакета освободилось место. ` +
      `Выберите новое занятие в сроке действия пакета (карточка клиента → Абонементы). ` +
      `[sub:${s.subscriptionId}]`
    const existing = await db.task.findFirst({
      where: {
        tenantId,
        clientId: s.clientId,
        autoTrigger: "reselect_package_lesson",
        status: "pending",
        deletedAt: null,
        description,
      },
      select: { id: true },
    })
    if (existing) continue
    await db.task.create({
      data: {
        tenantId,
        title: `Перевыбрать занятие пакета: ${nameById.get(s.clientId) ?? "Клиент"}`,
        description,
        type: "auto",
        autoTrigger: "reselect_package_lesson",
        status: "pending",
        dueDate: today,
        assignedTo: assignee.id,
        assignedBy: createdBy ?? null,
        clientId: s.clientId,
      },
    })
    created++
  }
  return created
}
