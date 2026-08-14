// Simple in-memory rate limiter for API routes
// For production at scale, replace with Redis-based solution

const hits = new Map<string, { count: number; resetAt: number }>()

// Cleanup old entries every 5 minutes
const _cleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, val] of hits) {
    if (val.resetAt < now) hits.delete(key)
  }
}, 5 * 60 * 1000)
_cleanupTimer.unref() // Don't prevent process exit

/**
 * Check rate limit for a given key (usually IP or IP+path).
 * Returns { ok: true } if allowed, { ok: false, retryAfter } if blocked.
 */
export function rateLimit(
  key: string,
  { maxRequests = 10, windowMs = 60_000 }: { maxRequests?: number; windowMs?: number } = {}
): { ok: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = hits.get(key)

  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }

  entry.count++
  if (entry.count > maxRequests) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }

  return { ok: true }
}

/**
 * Проверка лимита БЕЗ инкремента счётчика (read-only «peek»). Возвращает
 * { ok:false } только если в текущем окне УЖЕ накоплено >= maxRequests хитов.
 *
 * Нужна для входа, где в лимит должны попадать ТОЛЬКО неуспешные попытки: на
 * старте авторизации проверяем лимит этой функцией (сама проверка ничего не
 * прибавляет), а инкремент делаем отдельно (rateLimit) лишь при провале пароля.
 * Иначе успешные входы считались бы как брутфорс — и два пользователя за одним
 * IP/NAT (офис) блокировали бы друг друга.
 */
export function peekRateLimit(
  key: string,
  { maxRequests = 10 }: { maxRequests?: number } = {}
): { ok: boolean; retryAfter?: number } {
  const now = Date.now()
  const entry = hits.get(key)
  if (!entry || entry.resetAt < now) return { ok: true }
  if (entry.count >= maxRequests) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { ok: true }
}

/**
 * Tenant-level rate limiter (L-1 audit fix).
 * Limits total requests per tenant to prevent one tenant from overloading the system.
 * Default: 100 requests per minute per tenant.
 */
export function rateLimitTenant(
  tenantId: string,
  { maxRequests = 100, windowMs = 60_000 }: { maxRequests?: number; windowMs?: number } = {}
): { ok: boolean; retryAfter?: number } {
  return rateLimit(`tenant:${tenantId}`, { maxRequests, windowMs })
}

/**
 * Extract IP from request headers (works behind nginx/proxy).
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  const realIp = req.headers.get("x-real-ip")
  if (realIp) return realIp
  return "unknown"
}
