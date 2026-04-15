import { db } from "@/lib/db"
import { rateLimit } from "@/lib/rate-limit"

const LOGIN_MAX_ATTEMPTS = 5
const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 минут

interface LoginContext {
  login: string
  ip?: string
  userAgent?: string
}

/**
 * Проверяет rate limit по IP перед попыткой входа.
 * Возвращает null если можно продолжать, или строку с причиной блокировки.
 */
export function checkLoginRateLimit(ip: string): string | null {
  const result = rateLimit(`login:${ip}`, {
    maxRequests: LOGIN_MAX_ATTEMPTS,
    windowMs: LOGIN_WINDOW_MS,
  })
  if (!result.ok) {
    return `blocked_brute_force:${result.retryAfter}s`
  }
  return null
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
