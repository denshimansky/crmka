import type { Prisma, Role } from "@prisma/client"
import { isUnscoped, scopeTaskByBranch, type BranchScope } from "@/lib/branch-scope"

/**
 * Кто видит ВСЕ задачи организации.
 *
 * Управленческие роли (владелец, управляющий, администратор) видят полный список
 * задач тенанта. Остальные (инструктор, только чтение) — только задачи, назначенные
 * лично им (`assignedTo === employeeId`).
 *
 * Единая точка правды: используется и на дашборде, и на странице «Задачи», и в
 * API `/api/tasks`. Держите их синхронными.
 */
export function seesAllTasks(role: Role): boolean {
  return role === "owner" || role === "manager" || role === "admin"
}

/**
 * where-скоуп списка задач по роли + (опционально) по филиалу.
 *
 * Роль (кто видит все задачи vs только свои):
 *   • управленцы → `{}` (все задачи);
 *   • инструктор/только чтение → `{ assignedTo: employeeId }` (только свои).
 *
 * Филиал (ADM-04): если передан `scope` ограниченного админа — задачи режутся
 * по филиалу через scopeTaskByBranch (клиент/исполнитель/назначена лично мне).
 * Для управленцев и ролей со scope="all" фильтр по филиалу — no-op. Роль и
 * филиал комбинируются через AND (обе проверки должны пройти).
 *
 * Если у пользователя нет `employeeId` (теоретически невозможно для роли с
 * задачами) — вернём условие, которое не матчит ничего, чтобы не показать чужое.
 */
export function taskVisibilityWhere(
  role: Role,
  employeeId: string | null | undefined,
  scope?: BranchScope,
): Prisma.TaskWhereInput {
  const roleWhere: Prisma.TaskWhereInput = seesAllTasks(role)
    ? {}
    : { assignedTo: employeeId ?? "00000000-0000-0000-0000-000000000000" }

  const branchWhere: Prisma.TaskWhereInput =
    scope && !isUnscoped(scope) ? scopeTaskByBranch(scope, employeeId) : {}

  const hasRole = Object.keys(roleWhere).length > 0
  const hasBranch = Object.keys(branchWhere).length > 0
  if (hasRole && hasBranch) return { AND: [roleWhere, branchWhere] }
  return hasRole ? roleWhere : branchWhere
}
