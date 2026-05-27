import { Prisma, type PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

/**
 * Ф7: Создаёт задачу «Переназначить отработку» админу/управляющему/владельцу.
 *
 * Вызывается из двух мест:
 *  1. POST attendance — педагог поставил «Не был» на виртуальной строке отработки.
 *  2. PATCH lesson (status=cancelled) — целевое занятие отработки отменено.
 *
 * Идемпотентна: если задача с тем же autoTrigger+clientId+description уже
 * существует и не закрыта — повторно не создаёт.
 */
export async function createMissedMakeupTask(
  db: DB,
  params: {
    tenantId: string
    clientId: string
    /** Кто (для отображения в заголовке). */
    childDisplayName: string
    /** Исходное (пропущенное) занятие — описать чтобы админ понимал, что переназначать. */
    sourceLessonDate: Date
    sourceDirectionName: string
    /** Целевое (где должна была пройти отработка) — для контекста. */
    targetLessonDate: Date
    targetDirectionName: string
    /** Причина: «не явился» или «занятие отменено». */
    reason: "no_show" | "lesson_cancelled"
  },
): Promise<{ id: string } | null> {
  // Дефолтный исполнитель: первый менеджер/владелец/админ
  const assignee = await db.employee.findFirst({
    where: {
      tenantId: params.tenantId,
      deletedAt: null,
      isActive: true,
      role: { in: ["manager", "owner", "admin"] },
    },
    select: { id: true },
    orderBy: { role: "asc" },
  })
  if (!assignee) return null

  const reasonLabel =
    params.reason === "no_show"
      ? "не явился на отработку"
      : "целевое занятие отработки отменено"

  const description =
    `Ребёнок ${reasonLabel} ${params.targetLessonDate.toLocaleDateString("ru-RU")} ` +
    `(направление: ${params.targetDirectionName}). ` +
    `Исходный пропуск: ${params.sourceLessonDate.toLocaleDateString("ru-RU")} ` +
    `(${params.sourceDirectionName}). Назначьте новую дату отработки.`

  // Идемпотентность: ищем активную задачу с тем же описанием
  const existing = await db.task.findFirst({
    where: {
      tenantId: params.tenantId,
      clientId: params.clientId,
      autoTrigger: "missed_makeup",
      status: "pending",
      deletedAt: null,
      description,
    },
    select: { id: true },
  })
  if (existing) return existing

  const today = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))

  const task = await db.task.create({
    data: {
      tenantId: params.tenantId,
      title: `Переназначить отработку: ${params.childDisplayName}`,
      description,
      type: "auto",
      autoTrigger: "missed_makeup",
      status: "pending",
      dueDate: today,
      assignedTo: assignee.id,
      clientId: params.clientId,
    },
    select: { id: true },
  })
  return task
}
