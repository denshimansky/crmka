import type { Role } from "@prisma/client"

export const DEFAULT_ROLE_DISPLAY_NAMES: Record<Role, string> = {
  owner: "Владелец",
  manager: "Управляющий",
  admin: "Администратор",
  instructor: "Педагог",
  readonly: "Только чтение",
}

export const ALL_ROLES: Role[] = ["owner", "manager", "admin", "instructor", "readonly"]

/**
 * Возвращает отображаемое название роли с учётом кастомных настроек организации.
 * Если в org.roleDisplayNames есть кастомное название — вернёт его, иначе — дефолтное.
 */
export function getRoleDisplayName(
  role: Role,
  roleDisplayNames?: Record<string, string> | null,
): string {
  if (roleDisplayNames && role in roleDisplayNames) {
    return roleDisplayNames[role]
  }
  return DEFAULT_ROLE_DISPLAY_NAMES[role] ?? role
}
