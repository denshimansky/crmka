import { db } from "@/lib/db"
import { isTriggerEnabled, parseTriggerSettings } from "@/lib/tasks/trigger-settings"

/** Сегодняшняя дата как UTC-полночь — в одном формате с nextContactDate (@db.Date). */
function todayUtc(): Date {
  const n = new Date()
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))
}

export interface ContactDateTaskInput {
  tenantId: string
  clientId: string
  firstName: string | null
  lastName: string | null
  nextContactDate: Date | null
  today: Date
  assigneeId: string
}

/**
 * Идемпотентно создаёт автозадачу «Позвонить» по наступившей дате связи
 * (nextContactDate ≤ today) для одного клиента. Дубль не плодит: если уже есть
 * открытая contact_date-задача с dueDate ≥ nextContactDate — пропускает.
 * Возвращает true, если задача была создана.
 *
 * Низкоуровневый помощник: вызывающий уже разрешил исполнителя и «сегодня».
 * Используется и пакетной генерацией (generate-tasks — крон/кнопка «Автозадачи»),
 * и точечно при ручной установке даты связи (Баг #18 — задача должна попасть в
 * дашборд сразу, не дожидаясь следующего прогона генерации).
 */
export async function createContactDateTaskIfDue(input: ContactDateTaskInput): Promise<boolean> {
  const { tenantId, clientId, firstName, lastName, nextContactDate, today, assigneeId } = input
  if (!nextContactDate || nextContactDate > today) return false

  const exists = await db.task.findFirst({
    where: {
      tenantId,
      clientId,
      autoTrigger: "contact_date",
      deletedAt: null,
      dueDate: { gte: nextContactDate },
    },
    select: { id: true },
  })
  if (exists) return false

  await db.task.create({
    data: {
      tenantId,
      title: `Позвонить: ${[lastName, firstName].filter(Boolean).join(" ")}`,
      type: "auto",
      autoTrigger: "contact_date",
      status: "pending",
      dueDate: nextContactDate,
      assignedTo: assigneeId,
      clientId,
    },
  })
  return true
}

/**
 * Точечная обёртка для ручной установки даты связи (Баг #18): если выставленная
 * дата уже наступила (≤ сегодня), создаёт автозадачу «Позвонить» сразу — чтобы она
 * появилась в виджете «Задачи на сегодня», не дожидаясь крона/кнопки «Автозадачи».
 *
 * Сама находит дефолтного исполнителя (первый admin/manager/owner) и проверяет,
 * включён ли триггер contact_date в настройках организации — поведение совпадает с
 * пакетной генерацией. Безопасна как побочный эффект: при отсутствии исполнителя или
 * выключенном триггере тихо ничего не делает, ошибки только логирует (не должна
 * ронять сохранение клиента).
 */
export async function ensureContactDateTaskForClient(
  tenantId: string,
  clientId: string,
): Promise<void> {
  try {
    const today = todayUtc()

    const client = await db.client.findFirst({
      where: { id: clientId, tenantId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, nextContactDate: true },
    })
    if (!client?.nextContactDate || client.nextContactDate > today) return

    const org = await db.organization.findUnique({
      where: { id: tenantId },
      select: { taskTriggerSettings: true },
    })
    const settings = parseTriggerSettings(org?.taskTriggerSettings)
    if (!isTriggerEnabled("contact_date", settings, new Date())) return

    const assignee = await db.employee.findFirst({
      where: { tenantId, deletedAt: null, isActive: true, role: { in: ["admin", "manager", "owner"] } },
      select: { id: true },
      orderBy: { role: "asc" },
    })
    if (!assignee) return

    await createContactDateTaskIfDue({
      tenantId,
      clientId: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      nextContactDate: client.nextContactDate,
      today,
      assigneeId: assignee.id,
    })
  } catch (err) {
    console.error("[ensureContactDateTaskForClient]", err)
  }
}
