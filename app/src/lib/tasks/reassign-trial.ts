import type { Prisma, PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

/**
 * Задача «Переназначить пробное» — когда занятие, на которое записан лид,
 * отменяют.
 *
 * Групповое пробное живёт ссылкой на занятие и на карточке занятия не
 * отменяется (только в «Продажах»), поэтому после отмены занятия оно
 * оставалось бы висеть без занятия и без всякого сигнала администратору.
 * Зеркалит createMissedMakeupTask (lib/tasks/missed-makeup.ts), которым так же
 * закрывается отмена целевого занятия отработки.
 *
 * Идемпотентна: активная задача с тем же описанием повторно не создаётся.
 */
export async function createReassignTrialTask(
  db: DB,
  params: {
    tenantId: string
    clientId: string
    /** Кого переназначать — подопечный или, если его нет, сам лид. */
    childDisplayName: string
    /** Отменённое занятие — чтобы админ понимал, что именно сорвалось. */
    lessonDate: Date
    lessonStartTime: string
    directionName: string
    groupName: string
  },
): Promise<{ id: string } | null> {
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

  const description =
    `Занятие ${params.lessonDate.toLocaleDateString("ru-RU")} ${params.lessonStartTime} ` +
    `(${params.groupName}, ${params.directionName}) отменено, а на него было записано пробное. ` +
    `Свяжитесь с родителем и запишите ребёнка на другую дату («Продажи» → вкладка «Пробное»).`

  const existing = await db.task.findFirst({
    where: {
      tenantId: params.tenantId,
      clientId: params.clientId,
      autoTrigger: "reassign_trial",
      status: "pending",
      deletedAt: null,
      description,
    },
    select: { id: true },
  })
  if (existing) return existing

  const now = new Date()
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  )

  return db.task.create({
    data: {
      tenantId: params.tenantId,
      title: `Переназначить пробное: ${params.childDisplayName}`,
      description,
      type: "auto",
      autoTrigger: "reassign_trial",
      status: "pending",
      dueDate: today,
      assignedTo: assignee.id,
      clientId: params.clientId,
    },
    select: { id: true },
  })
}
