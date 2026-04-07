// Simple in-memory rate limiter for API routes
// For production at scale, replace with Redis-based solution

const hits = new Map<string, { count: number; resetAt: number }>()

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of hits) {
    if (val.resetAt < now) hits.delete(key)
  }
}, 5 * 60 * 1000)

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
 * Extract IP from request headers (works behind nginx/proxy).
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  const realIp = req.headers.get("x-real-ip")
  if (realIp) return realIp
  return "unknown"
}
