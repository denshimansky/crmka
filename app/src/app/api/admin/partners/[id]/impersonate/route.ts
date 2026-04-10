import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { encode } from "next-auth/jwt"

// POST /api/admin/partners/[id]/impersonate — войти как owner партнёра
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "support") {
    return NextResponse.json({ error: "Forbidden: только superadmin и support" }, { status: 403 })
  }

  const { id } = await params

  // Найти организацию
  const org = await db.organization.findUnique({
    where: { id },
    select: { id: true, name: true, billingStatus: true },
  })
  if (!org) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
  }

  // Найти owner-сотрудника этой организации
  const owner = await db.employee.findFirst({
    where: {
      tenantId: id,
      role: "owner",
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, firstName: true, lastName: true, email: true, role: true },
  })

  if (!owner) {
    return NextResponse.json({ error: "У партнёра нет активного владельца" }, { status: 404 })
  }

  // Записать в AuditLog
  await db.auditLog.create({
    data: {
      tenantId: id,
      userId: session.adminId,
      action: "impersonate",
      entityType: "employee",
      entityId: owner.id,
      changes: {
        adminEmail: session.email,
        adminName: session.name,
        adminRole: session.role,
        targetOrg: org.name,
        targetOwner: `${owner.lastName} ${owner.firstName}`,
      },
    },
  })

  // Создать NextAuth JWT-токен для owner
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    return NextResponse.json({ error: "NEXTAUTH_SECRET not configured" }, { status: 500 })
  }

  const token = await encode({
    secret,
    token: {
      sub: owner.id,
      name: `${owner.lastName} ${owner.firstName}`,
      email: owner.email,
      role: owner.role,
      tenantId: id,
      employeeId: owner.id,
      orgName: org.name,
      billingStatus: org.billingStatus,
      // Маркер impersonation — чтобы показать плашку
      impersonatedBy: session.email,
      impersonatedAt: new Date().toISOString(),
    },
    maxAge: 60 * 60, // 1 час (не 24, для безопасности)
  })

  // Устанавливаем cookie next-auth.session-token
  const cookieName = process.env.NODE_ENV === "production"
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token"

  const response = NextResponse.json({
    ok: true,
    org: org.name,
    owner: `${owner.lastName} ${owner.firstName}`,
  })

  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  })

  return response
}
