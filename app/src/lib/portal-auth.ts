import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { db } from "@/lib/db"

// Lazy чтобы Next.js build (где ENV не подгружены) не падал.
// Throw срабатывает на первом реальном использовании в рантайме.
let _secret: Uint8Array | null = null
function getSecret(): Uint8Array {
  if (_secret) return _secret
  const raw = process.env.PORTAL_JWT_SECRET || process.env.NEXTAUTH_SECRET
  const isWeak = !raw || raw.length < 32 || raw === "change-me-to-random-string"
  if (isWeak && process.env.NODE_ENV === "production") {
    throw new Error("PORTAL_JWT_SECRET or NEXTAUTH_SECRET must be set to a strong value (≥32 chars) in production")
  }
  if (isWeak) {
    console.warn("[portal-auth] WARNING: using weak/missing JWT secret — set PORTAL_JWT_SECRET (≥32 chars) in .env")
  }
  _secret = new TextEncoder().encode(raw || "dev-only-insecure-secret-do-not-use-in-prod")
  return _secret
}

export const PORTAL_COOKIE_NAME = "portal-token"
export const PORTAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 дней

// v2 — парольный вход (/p/<slug>). Токены без v===2 (старый токен-вход)
// отвергаются: все выданные до перехода cookie автоматически инвалидны.
export interface PortalPayload {
  v: 2
  clientId: string
  tenantId: string
  slug: string
  clientName: string
  /** Проставляется jose при подписи; нужен requirePortalAccount */
  iat?: number
}

export async function signPortalToken(payload: PortalPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret())
}

export async function verifyPortalToken(token: string): Promise<PortalPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if ((payload as { v?: number }).v !== 2) return null
    return payload as unknown as PortalPayload
  } catch {
    return null
  }
}

export async function getPortalSession(): Promise<PortalPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(PORTAL_COOKIE_NAME)?.value
  if (!token) return null
  return verifyPortalToken(token)
}

/**
 * Проверка учётки на каждом data-запросе портала: учётка активна, клиент жив,
 * сессия выдана не раньше последнего перевыпуска пароля (перевыпуск/деактивация
 * убивают все выданные JWT). Возвращает null, если доступ надо отклонить.
 */
export async function requirePortalAccount(session: PortalPayload) {
  const account = await db.clientPortalAccount.findUnique({
    where: { clientId: session.clientId },
    select: {
      id: true,
      isActive: true,
      passwordIssuedAt: true,
      client: { select: { deletedAt: true } },
    },
  })
  if (!account || !account.isActive || account.client.deletedAt) return null
  // 5 секунд слака: iat в секундах, passwordIssuedAt пишется тем же сервером
  if (session.iat && session.iat * 1000 < account.passwordIssuedAt.getTime() - 5000) {
    return null
  }
  return account
}
