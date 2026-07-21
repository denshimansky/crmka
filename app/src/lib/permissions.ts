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
  // Телефоны инструктора всегда маскируются (см. lib/permissions/phone-visibility.ts) —
  // PRD §5.4: жёсткая политика, не настраивается через матрицу.
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
  { key: "finance.result", label: "Финансовый результат (ДДС, P&L, маржа)", group: "Финансы" },
  { key: "finance.salary", label: "Зарплатная ведомость и выплаты всех", group: "Финансы" },
  { key: "salary.own", label: "Просмотр своей зарплаты", group: "Финансы" },
  { key: "finance.refund", label: "Возвраты средств", group: "Финансы" },
  { key: "payments.delete", label: "Удаление оплат", group: "Финансы" },

  // Абонементы
  { key: "subscriptions.view", label: "Просмотр абонементов", group: "Абонементы" },
  { key: "subscriptions.edit", label: "Создание и редактирование абонементов", group: "Абонементы" },

  // Отчёты — по блокам (баг #77): каждый блок открывается/скрывается отдельно.
  { key: "reports.marketing", label: "Маркетинг и продажи", group: "Отчёты" },
  { key: "reports.retention", label: "Отток и удержание", group: "Отчёты" },
  { key: "reports.schedule", label: "Расписание и посещения", group: "Отчёты" },
  { key: "reports.finance", label: "Финансы", group: "Отчёты" },
  { key: "reports.salary", label: "Зарплата и педагоги", group: "Отчёты" },

  // Персонал
  { key: "staff.view", label: "Просмотр сотрудников", group: "Персонал" },
  { key: "staff.edit", label: "Управление сотрудниками", group: "Персонал" },

  // Настройки
  { key: "settings.view", label: "Просмотр настроек", group: "Настройки" },
  { key: "settings.edit", label: "Редактирование настроек организации", group: "Настройки" },
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]["key"]

/** Права на блоки отчётов (баг #77). Индекс /reports и пункт сайдбара «Отчёты»
 *  доступны, если у роли есть ХОТЯ БЫ ОДНО из них. */
export const REPORT_PERMISSION_KEYS = [
  "reports.marketing",
  "reports.retention",
  "reports.schedule",
  "reports.finance",
  "reports.salary",
] as const satisfies readonly PermissionKey[]

// ─── Дефолтные права по ролям ───

export type RolePermissions = Record<string, Record<PermissionKey, boolean>>

/** Роли, которые видны в матрице (без owner — у него всё включено) */
export const EDITABLE_ROLES: Role[] = ["manager", "admin", "instructor", "readonly"]

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
    // Управляющий по умолчанию может всё, кроме удаления клиентов и оплат.
    // Удаление оплат — деньги: владелец включает явно через матрицу прав.
    "clients.delete": false,
    "payments.delete": false,
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
    "finance.result": false, // PRD §5.3: админ по умолчанию не видит финрез (ДДС/P&L)
    "finance.salary": false,
    "salary.own": false,
    "finance.refund": false,
    "subscriptions.view": true,
    "subscriptions.edit": true,
    // Отчёты по умолчанию скрыты у админа (все 5 блоков — через ALL_FALSE).
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
    "salary.own": true, // PRD §5.4: инструктор видит свою ЗП
  },
  readonly: {
    ...ALL_FALSE,
    "clients.view": true,
    "schedule.view": true,
    "finance.view": true,
    "finance.result": true,
    "subscriptions.view": true,
    // Отчёты: как раньше при reports.view=true + finance.result=true, но без
    // зарплатных отчётов (finance.salary у readonly был выключен).
    "reports.marketing": true,
    "reports.retention": true,
    "reports.schedule": true,
    "reports.finance": true,
    "staff.view": true,
    "settings.view": true,
  },
}

// ─── Хелпер проверки прав ───

// Обратная совместимость (баг #77): раздельные права на блоки отчётов заменили
// единый reports.view (а финансовые/зарплатные отчёты гейтились finance.result/
// finance.salary). Пока владелец не пересохранил матрицу, новые ключи наследуют
// значение старого — доступ сохраняется точь-в-точь, миграция БД не нужна.
const LEGACY_REPORT_FALLBACK: Partial<Record<PermissionKey, string>> = {
  "reports.marketing": "reports.view",
  "reports.retention": "reports.view",
  "reports.schedule": "reports.view",
  "reports.finance": "finance.result",
  "reports.salary": "finance.salary",
}

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
  const custom = orgPermissions?.[role] as Record<string, boolean> | undefined
  if (custom) {
    if (typeof custom[permission] === "boolean") return custom[permission]
    // Новый report-ключ ещё не сохранён — наследуем старый (см. выше).
    const legacy = LEGACY_REPORT_FALLBACK[permission]
    if (legacy && typeof custom[legacy] === "boolean") return custom[legacy]
    return DEFAULT_PERMISSIONS[role]?.[permission] ?? false
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
