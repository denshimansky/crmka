import type { Prisma, Role } from "@prisma/client"

/**
 * Кто видит ВСЕ задачи организации.
 *
 * Управленческие роли (владелец, управляющий, администратор) видят полный список
 * задач тенанта. Остальные (педагог, только чтение) — только задачи, назначенные
 * лично им (`assignedTo === employeeId`).
 *
 * Единая точка правды: используется и на дашборде, и на странице «Задачи», и в
 * API `/api/tasks`. Держите их синхронными.
 */
export function seesAllTasks(role: Role): boolean {
  return role === "owner" || role === "manager" || role === "admin"
}

/**
 * where-скоуп списка задач по роли.
 *   • управленцы → `{}` (все задачи);
 *   • педагог/только чтение → `{ assignedTo: employeeId }` (только свои).
 *
 * Если у пользователя нет `employeeId` (теоретически невозможно для роли с
 * задачами) — вернём условие, которое не матчит ничего, чтобы не показать чужое.
 */
export function taskVisibilityWhere(
  role: Role,
  employeeId: string | null | undefined,
): Prisma.TaskWhereInput {
  if (seesAllTasks(role)) return {}
  return {
    assignedTo: employeeId ?? "00000000-0000-0000-0000-000000000000",
  }
}
