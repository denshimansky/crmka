import type { PermissionKey } from "./permissions"

/**
 * Карта маршрутов dashboard → необходимое разрешение.
 *
 * Применяется longest-prefix match. Если маршрут не найден — доступ
 * разрешён всем авторизованным (например, главная `/`).
 *
 * Замечания:
 * - `/billing` обрабатывается отдельно (только owner/manager — hardcoded в layout).
 * - `/finance/cash` подпадает под `/finance` (нужно finance.view).
 */
const PATH_PERMISSIONS: Array<{ prefix: string; permission: PermissionKey }> = [
  // CRM
  { prefix: "/crm", permission: "clients.view" },

  // Расписание и связанные операционные разделы
  { prefix: "/schedule", permission: "schedule.view" },
  { prefix: "/stock", permission: "schedule.view" },
  { prefix: "/tasks", permission: "clients.view" },

  // Финансы
  { prefix: "/salary", permission: "finance.salary" },
  { prefix: "/finance", permission: "finance.view" },

  // Отчёты
  { prefix: "/reports", permission: "reports.view" },

  // Персонал
  { prefix: "/staff", permission: "staff.view" },

  // Настройки
  { prefix: "/settings", permission: "settings.view" },
]

/**
 * Возвращает PermissionKey, требуемый для доступа к указанному пути, или null.
 * Если path не покрыт картой — null (доступ открыт авторизованным).
 */
export function requiredPermissionForPath(pathname: string): PermissionKey | null {
  // Точное совпадение с / — всегда null
  if (pathname === "/" || pathname === "") return null

  const match = PATH_PERMISSIONS
    .filter((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0]

  return match?.permission ?? null
}
