import type { Role } from "@prisma/client"

export const DEFAULT_ROLE_DISPLAY_NAMES: Record<Role, string> = {
  owner: "Владелец",
  manager: "Управляющий",
  admin: "Администратор",
  instructor: "Инструктор",
  readonly: "Только чтение",
}

export const ALL_ROLES: Role[] = ["owner", "manager", "admin", "instructor", "readonly"]

/**
 * Возвращает отображаемое название роли с учётом кастомных настроек организации.
 * Если в org.roleDisplayNames есть непустое кастомное название — вернёт его
 * (с trim), иначе — дефолтное. Семантика едина с resolveRoleDisplayNames.
 */
export function getRoleDisplayName(
  role: Role,
  roleDisplayNames?: Record<string, string> | null,
): string {
  const value = roleDisplayNames?.[role]
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }
  return DEFAULT_ROLE_DISPLAY_NAMES[role] ?? role
}

/**
 * Полная мапа отображаемых названий ролей: кастомные настройки организации
 * поверх дефолтных. Пустые/пробельные кастомные значения игнорируются.
 */
export function resolveRoleDisplayNames(
  roleDisplayNames?: Record<string, string> | null,
): Record<Role, string> {
  const merged = { ...DEFAULT_ROLE_DISPLAY_NAMES }
  if (roleDisplayNames) {
    for (const role of ALL_ROLES) {
      const value = roleDisplayNames[role]
      if (typeof value === "string" && value.trim()) {
        merged[role] = value.trim()
      }
    }
  }
  return merged
}
