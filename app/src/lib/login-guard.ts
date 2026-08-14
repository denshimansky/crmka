import { db } from "@/lib/db"
import { peekRateLimit, rateLimit } from "@/lib/rate-limit"

// В лимит попадают ТОЛЬКО неуспешные попытки (см. recordFailedLogin): успешные
// входы не считаются, иначе два легитимных пользователя за одним IP/NAT (офис —
// напр. владелец + управляющий с разных ПК) блокировали бы друг друга как брутфорс.
const LOGIN_MAX_ATTEMPTS = 30
const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 минут

interface LoginContext {
  login: string
  ip?: string
  userAgent?: string
}

/**
 * Проверяет rate limit по IP перед попыткой входа — БЕЗ инкремента (peek).
 * Счётчик растят только неуспешные попытки (recordFailedLogin).
 * Возвращает null если можно продолжать, или строку с причиной блокировки.
 */
export function checkLoginRateLimit(ip: string): string | null {
  const result = peekRateLimit(`login:${ip}`, { maxRequests: LOGIN_MAX_ATTEMPTS })
  if (!result.ok) {
    return `blocked_brute_force:${result.retryAfter}s`
  }
  return null
}

/**
 * Инкремент счётчика брутфорса по IP — вызывать ТОЛЬКО при НЕУСПЕШНОЙ попытке
 * (неверный пароль / неизвестный пользователь). Успешный вход счётчик не трогает.
 */
export function recordFailedLogin(ip: string): void {
  rateLimit(`login:${ip}`, {
    maxRequests: LOGIN_MAX_ATTEMPTS,
    windowMs: LOGIN_WINDOW_MS,
  })
}

/**
 * Записывает попытку входа в БД (fire-and-forget).
 */
export function logLoginAttempt(
  ctx: LoginContext & {
    success: boolean
    reason?: string
    tenantId?: string
    employeeId?: string
  }
): void {
  db.loginAttempt
    .create({
      data: {
        login: ctx.login.slice(0, 255),
        success: ctx.success,
        ipAddress: ctx.ip || null,
        userAgent: ctx.userAgent?.slice(0, 500) || null,
        tenantId: ctx.tenantId || null,
        employeeId: ctx.employeeId || null,
        reason: ctx.reason || null,
      },
    })
    .catch((e) => console.error("[login-guard] log failed:", e))
}
