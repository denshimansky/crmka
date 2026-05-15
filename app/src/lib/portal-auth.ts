import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { db } from "@/lib/db"
import { randomBytes } from "crypto"

const rawSecret = process.env.PORTAL_JWT_SECRET || process.env.NEXTAUTH_SECRET
if (!rawSecret || rawSecret.length < 32 || rawSecret === "change-me-to-random-string") {
  if (process.env.NODE_ENV === "production") {
    throw new Error("PORTAL_JWT_SECRET or NEXTAUTH_SECRET must be set to a strong value (≥32 chars) in production")
  }
  console.warn("[portal-auth] WARNING: using weak/missing JWT secret — set PORTAL_JWT_SECRET (≥32 chars) in .env")
}
const SECRET = new TextEncoder().encode(rawSecret || "dev-only-insecure-secret-do-not-use-in-prod")

const COOKIE_NAME = "portal-token"

export interface PortalPayload {
  clientId: string
  tenantId: string
  clientName: string
  pdnConsent: boolean
}

export async function signPortalToken(payload: PortalPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(SECRET)
}

export async function verifyPortalToken(token: string): Promise<PortalPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as PortalPayload
  } catch {
    return null
  }
}

export async function getPortalSession(): Promise<PortalPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyPortalToken(token)
}

export function generatePortalToken(): string {
  return randomBytes(32).toString("hex")
}

export async function authenticateByToken(accessToken: string) {
  const portalToken = await db.clientPortalToken.findUnique({
    where: { token: accessToken, isActive: true },
    include: {
      client: {
        select: { id: true, tenantId: true, firstName: true, lastName: true },
      },
    },
  })
  if (!portalToken) return null

  // Обновляем last accessed
  await db.clientPortalToken.update({
    where: { id: portalToken.id },
    data: { lastAccessedAt: new Date() },
  })

  const payload: PortalPayload = {
    clientId: portalToken.client.id,
    tenantId: portalToken.tenantId,
    clientName: `${portalToken.client.lastName || ""} ${portalToken.client.firstName || ""}`.trim() || "Клиент",
    pdnConsent: portalToken.pdnConsent,
  }

  const jwt = await signPortalToken(payload)
  return { jwt, portal: payload, pdnConsent: portalToken.pdnConsent }
}
