import { type Role } from "@prisma/client"

/**
 * Система прав ролей.
 *
 * Права хранятся в organization.rolePermissions (JSON).
 * Если поле null — используются дефолты.
 * Owner всегда имеет все права (не редактируется).
 */

// ─── Список разрешений ───

export const PERMISSIONS = [
  // Клиенты / Лиды
  { key: "clients.view", label: "Просмотр клиентов и лидов", group: "Клиенты" },
  { key: "clients.edit", label: "Создание и редактирование клиентов", group: "Клиенты" },
  { key: "clients.delete", label: "Удаление клиентов", group: "Клиенты" },

  // Расписание
  { key: "schedule.view", label: "Просмотр расписания", group: "Расписание" },
  { key: "schedule.edit", label: "Управление группами и расписанием", group: "Расписание" },
  { key: "attendance.mark", label: "Отметка посещений", group: "Расписание" },

  // Финансы
  { key: "finance.view", label: "Просмотр финансов (оплаты, расходы)", group: "Финансы" },
  { key: "finance.edit", label: "Создание оплат и расходов", group: "Финансы" },
  { key: "finance.salary", label: "Зарплатная ведомость и выплаты", group: "Финансы" },
  { key: "finance.refund", label: "Возвраты средств", group: "Финансы" },

  // Абонементы
  { key: "subscriptions.view", label: "Просмотр абонементов", group: "Абонементы" },
  { key: "subscriptions.edit", label: "Создание и редактирование абонементов", group: "Абонементы" },

  // Отчёты
  { key: "reports.view", label: "Просмотр отчётов", group: "Отчёты" },

  // Персонал
  { key: "staff.view", label: "Просмотр сотрудников", group: "Персонал" },
  { key: "staff.edit", label: "Управление сотрудниками", group: "Персонал" },

  // Настройки
  { key: "settings.view", label: "Просмотр настроек", group: "Настройки" },
  { key: "settings.edit", label: "Редактирование настроек организации", group: "Настройки" },
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]["key"]

// ─── Дефолтные права по ролям ───

export type RolePermissions = Record<string, Record<PermissionKey, boolean>>

/** Роли, которые видны в матрице (без owner — у него всё включено) */
export const EDITABLE_ROLES: Role[] = ["manager", "admin", "instructor", "readonly"]

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  manager: "Управляющий",
  admin: "Администратор",
  instructor: "Инструктор",
  readonly: "Только чтение",
}

const ALL_TRUE = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, true])
) as Record<PermissionKey, boolean>

const ALL_FALSE = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, false])
) as Record<PermissionKey, boolean>

export const DEFAULT_PERMISSIONS: RolePermissions = {
  owner: { ...ALL_TRUE },
  manager: {
    ...ALL_TRUE,
    // Управляющий по умолчанию может всё, кроме удаления клиентов
    "clients.delete": false,
  },
  admin: {
    ...ALL_FALSE,
    "clients.view": true,
    "clients.edit": true,
    "clients.delete": false,
    "schedule.view": true,
    "schedule.edit": false,
    "attendance.mark": true,
    "finance.view": true,
    "finance.edit": true,
    "finance.salary": false,
    "finance.refund": false,
    "subscriptions.view": true,
    "subscriptions.edit": true,
    "reports.view": false,
    "staff.view": true,
    "staff.edit": false,
    "settings.view": true,
    "settings.edit": false,
  },
  instructor: {
    ...ALL_FALSE,
    "clients.view": true,
    "schedule.view": true,
    "attendance.mark": true,
    "subscriptions.view": true,
  },
  readonly: {
    ...ALL_FALSE,
    "clients.view": true,
    "schedule.view": true,
    "finance.view": true,
    "subscriptions.view": true,
    "reports.view": true,
    "staff.view": true,
    "settings.view": true,
  },
}

// ─── Хелпер проверки прав ───

/**
 * Проверяет, имеет ли роль указанное разрешение.
 * @param role — роль сотрудника
 * @param permission — ключ разрешения
 * @param orgPermissions — JSON из organization.rolePermissions (может быть null)
 */
export function hasPermission(
  role: Role,
  permission: PermissionKey,
  orgPermissions?: RolePermissions | null
): boolean {
  // Owner всегда имеет все права
  if (role === "owner") return true

  // Если у организации настроены права — используем их
  if (orgPermissions && orgPermissions[role]) {
    return orgPermissions[role][permission] ?? DEFAULT_PERMISSIONS[role]?.[permission] ?? false
  }

  // Иначе — дефолты
  return DEFAULT_PERMISSIONS[role]?.[permission] ?? false
}

/**
 * Возвращает полную матрицу прав для организации (с учётом кастомных настроек).
 */
export function getEffectivePermissions(
  orgPermissions?: RolePermissions | null
): RolePermissions {
  const result: RolePermissions = {}

  for (const role of ["owner", ...EDITABLE_ROLES] as Role[]) {
    result[role] = {} as Record<PermissionKey, boolean>
    for (const perm of PERMISSIONS) {
      result[role][perm.key] = hasPermission(role, perm.key, orgPermissions)
    }
  }

  return result
}
