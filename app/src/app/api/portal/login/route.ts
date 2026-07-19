import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { normalizePhone } from "@/lib/phone"
import { verifyPortalPassword } from "@/lib/portal-password"
import {
  signPortalToken,
  PORTAL_COOKIE_NAME,
  PORTAL_COOKIE_MAX_AGE,
  type PortalPayload,
} from "@/lib/portal-auth"
import { rateLimit, getClientIp } from "@/lib/rate-limit"
import { logLoginAttempt } from "@/lib/login-guard"

const bodySchema = z.object({
  slug: z.string().min(1),
  phone: z.string().min(1),
  password: z.string().min(1),
})

// Единый ответ на любую причину отказа — не раскрываем существование
// центра/учётки/телефона.
const FAIL = { error: "Неверный телефон или пароль" }

// POST /api/portal/login — вход родителя: { slug, phone, password }
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const userAgent = req.headers.get("user-agent") || undefined

  const ipLimit = rateLimit(`portal-login:${ip}`, { maxRequests: 5, windowMs: 15 * 60 * 1000 })
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: `Слишком много попыток. Повторите через ${Math.ceil((ipLimit.retryAfter || 60) / 60)} мин.` },
      { status: 429 }
    )
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(FAIL, { status: 401 })
  }
  const { slug, phone, password } = parsed.data
  const logLogin = `portal:${slug}:${phone}`.slice(0, 255)

  const org = await db.organization.findUnique({
    where: { portalSlug: slug },
    select: { id: true },
  })
  const loginPhone = normalizePhone(phone)
  if (!org || !loginPhone) {
    logLoginAttempt({ login: logLogin, ip, userAgent, success: false, reason: "portal_unknown_target" })
    return NextResponse.json(FAIL, { status: 401 })
  }

  // Второй контур против распределённого перебора одной учётки
  const targetLimit = rateLimit(`portal-login:${org.id}:${loginPhone}`, {
    maxRequests: 10,
    windowMs: 15 * 60 * 1000,
  })
  if (!targetLimit.ok) {
    logLoginAttempt({ login: logLogin, ip, userAgent, success: false, tenantId: org.id, reason: "portal_target_rate_limit" })
    return NextResponse.json(
      { error: `Слишком много попыток. Повторите через ${Math.ceil((targetLimit.retryAfter || 60) / 60)} мин.` },
      { status: 429 }
    )
  }

  const account = await db.clientPortalAccount.findUnique({
    where: { tenantId_loginPhone: { tenantId: org.id, loginPhone } },
    select: {
      id: true,
      isActive: true,
      passwordHash: true,
      client: { select: { id: true, firstName: true, lastName: true, deletedAt: true } },
    },
  })
  if (!account || !account.isActive || account.client.deletedAt) {
    logLoginAttempt({ login: logLogin, ip, userAgent, success: false, tenantId: org.id, reason: "portal_no_account" })
    return NextResponse.json(FAIL, { status: 401 })
  }

  const passwordOk = await verifyPortalPassword(password, account.passwordHash)
  if (!passwordOk) {
    logLoginAttempt({ login: logLogin, ip, userAgent, success: false, tenantId: org.id, reason: "portal_wrong_password" })
    return NextResponse.json(FAIL, { status: 401 })
  }

  await db.clientPortalAccount.update({
    where: { id: account.id },
    data: { lastLoginAt: new Date() },
  })
  logLoginAttempt({ login: logLogin, ip, userAgent, success: true, tenantId: org.id })

  const payload: PortalPayload = {
    v: 2,
    clientId: account.client.id,
    tenantId: org.id,
    slug,
    clientName:
      `${account.client.lastName || ""} ${account.client.firstName || ""}`.trim() || "Клиент",
  }
  const jwt = await signPortalToken(payload)

  const response = NextResponse.json({ ok: true })
  response.cookies.set(PORTAL_COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PORTAL_COOKIE_MAX_AGE,
    path: "/",
  })
  return response
}
