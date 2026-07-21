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
  { prefix: "/finance/dds", permission: "finance.result" },
  { prefix: "/finance", permission: "finance.view" },

  // Отчёты — по блокам (баг #77). Longest-prefix match: два churn-отчёта живут
  // под /reports/crm, поэтому их специфичные префиксы перекрывают общий /reports/crm.
  { prefix: "/reports/crm/subscriptions-by-instructor", permission: "reports.retention" },
  { prefix: "/reports/crm/trial-conversion", permission: "reports.retention" },
  { prefix: "/reports/crm", permission: "reports.marketing" },
  { prefix: "/reports/churn", permission: "reports.retention" },
  { prefix: "/reports/schedule", permission: "reports.schedule" },
  { prefix: "/reports/attendance", permission: "reports.schedule" },
  { prefix: "/reports/finance", permission: "reports.finance" },
  { prefix: "/reports/salary", permission: "reports.salary" },
  // Индекс /reports (точное совпадение) обрабатывается в layout — доступен при
  // ЛЮБОМ из report-прав. Этот фоллбэк ловит только будущие подмаршруты /reports/*.
  { prefix: "/reports", permission: "reports.marketing" },

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
