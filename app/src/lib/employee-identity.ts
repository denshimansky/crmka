import { Prisma, type PrismaClient } from "@prisma/client"

type Db = PrismaClient | Prisma.TransactionClient

// Нормализация логина/email для СРАВНЕНИЯ: trim + нижний регистр. Хранятся они
// как ввёл пользователь (только trim, регистр сохраняется для отображения),
// а сравнение при входе и проверке уникальности — всегда по нормализованному
// виду. Решение владельца 02.08.2026: ЛОГИН уникален глобально (вход по логину
// ищет по всей системе), EMAIL — в рамках центра (один email может числиться в
// разных центрах, напр. владелец нескольких орг.; вход по email при этом
// разводится по ambiguous в auth.ts).
export function normalizeIdentity(s: string): string {
  return s.trim().toLowerCase()
}

// mode:"insensitive" сужает выборку в БД (ILIKE-подобно), но трактует '_'/'%'
// как wildcard и не убирает хвостовые пробелы в хранимом значении — поэтому
// финальное сравнение всегда точное, по lower(trim()) в JS.
async function takenBy(
  db: Db,
  field: "login" | "email",
  value: string,
  tenantId: string | null,
  excludeId?: string,
): Promise<boolean> {
  const norm = normalizeIdentity(value)
  if (!norm) return false
  const rows = await db.employee.findMany({
    where: {
      [field]: { equals: value.trim(), mode: "insensitive" },
      deletedAt: null,
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true, login: true, email: true },
  })
  return rows.some(
    (r) => r.id !== excludeId && ((field === "login" ? r.login : r.email) ?? "").trim().toLowerCase() === norm,
  )
}

/** Занят ли ЛОГИН глобально (регистро-/пробелонезависимо). excludeId — при редактировании. */
export function isLoginTaken(db: Db, login: string, excludeId?: string): Promise<boolean> {
  return takenBy(db, "login", login, null, excludeId)
}

/** Занят ли EMAIL в рамках центра (регистро-/пробелонезависимо). excludeId — при редактировании. */
export function isEmailTaken(db: Db, email: string, tenantId: string, excludeId?: string): Promise<boolean> {
  return takenBy(db, "email", email, tenantId, excludeId)
}

export const LOGIN_TAKEN_MSG = "Логин уже занят — он должен быть уникальным по всей системе"
export const EMAIL_TAKEN_MSG =
  "Этот email уже используется — он должен быть уникальным (это второй логин и адрес для сброса пароля)"

// Проверки isLoginTaken/isEmailTaken — check-then-insert (TOCTOU): при гонке
// параллельных запросов вставка может нарушить БД-индекс уже ПОД проверкой.
// Ловим P2002 от employees_login_lower_active_key / _tenant_email_lower_active_key
// и отдаём дружелюбный 409 вместо 500. meta.target = имя индекса.
export function uniqueViolationMessage(e: unknown): string | null {
  if (!e || typeof e !== "object" || (e as { code?: string }).code !== "P2002") return null
  const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? "")
  if (target.includes("email")) return EMAIL_TAKEN_MSG
  if (target.includes("login")) return LOGIN_TAKEN_MSG
  return "Такой логин или email уже используется"
}
