import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { db } from "@/lib/db"
import bcrypt from "bcryptjs"
import type { AdminRole } from "@prisma/client"

const rawSecret = process.env.ADMIN_JWT_SECRET || process.env.NEXTAUTH_SECRET
if (!rawSecret || rawSecret.length < 32 || rawSecret === "change-me-to-random-string") {
  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_JWT_SECRET or NEXTAUTH_SECRET must be set to a strong value (≥32 chars) in production")
  }
  console.warn("[admin-auth] WARNING: using weak/missing JWT secret — set ADMIN_JWT_SECRET (≥32 chars) in .env")
}
const SECRET = new TextEncoder().encode(rawSecret || "dev-only-insecure-secret-do-not-use-in-prod")

const COOKIE_NAME = "admin-token"

export interface AdminPayload {
  adminId: string
  email: string
  name: string
  role: AdminRole
}

export async function signAdminToken(payload: AdminPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(SECRET)
}

export async function verifyAdminToken(token: string): Promise<AdminPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as AdminPayload
  } catch {
    return null
  }
}

export async function getAdminSession(): Promise<AdminPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyAdminToken(token)
}

export async function authenticateAdmin(email: string, password: string) {
  const admin = await db.adminUser.findUnique({
    where: { email, isActive: true },
  })
  if (!admin) return null

  const valid = await bcrypt.compare(password, admin.passwordHash)
  if (!valid) return null

  const payload: AdminPayload = {
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  }

  const token = await signAdminToken(payload)
  return { token, admin: payload }
}
