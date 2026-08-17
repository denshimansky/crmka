import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { encode } from "next-auth/jwt"

// POST /api/admin/partners/[id]/impersonate — войти под сотрудником партнёра.
// Тело { employeeId } — войти под конкретным сотрудником (для проверки зон
// видимости и прав других ролей). Без тела — фолбэк на владельца (owner).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "support") {
    return NextResponse.json({ error: "Forbidden: только superadmin и support" }, { status: 403 })
  }

  const { id } = await params

  // employeeId необязателен: если тела нет/битое — входим под владельцем.
  let employeeId: string | undefined
  try {
    const body = await req.json()
    if (body && typeof body.employeeId === "string" && body.employeeId) {
      employeeId = body.employeeId
    }
  } catch {
    // тело не передано — фолбэк на owner ниже
  }

  // Найти организацию
  const org = await db.organization.findUnique({
    where: { id },
    select: { id: true, name: true, billingStatus: true, instructorsSeePhones: true },
  })
  if (!org) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
  }

  // Найти целевого сотрудника: конкретного по employeeId либо владельца.
  const employee = await db.employee.findFirst({
    where: {
      tenantId: id,
      isActive: true,
      deletedAt: null,
      ...(employeeId ? { id: employeeId } : { role: "owner" }),
    },
    select: { id: true, firstName: true, lastName: true, email: true, role: true },
  })

  if (!employee) {
    return NextResponse.json(
      { error: employeeId ? "Сотрудник не найден или неактивен" : "У партнёра нет активного владельца" },
      { status: 404 },
    )
  }

  // Зоны видимости по филиалам (ADM-04): owner/manager видят все (null),
  // admin/instructor/readonly — по привязкам EmployeeBranch (пусто = все).
  // Повторяет логику jwt-колбэка в lib/auth.ts, чтобы CRM открылась сразу
  // с корректными филиалами, а не после первого рефреша токена.
  let allowedBranchIds: string[] | null = null
  if (employee.role !== "owner" && employee.role !== "manager") {
    const links = await db.employeeBranch.findMany({
      where: { tenantId: id, employeeId: employee.id },
      select: { branchId: true },
    })
    allowedBranchIds = links.length === 0 ? null : links.map((l) => l.branchId)
  }

  // Записать в AuditLog
  await db.auditLog.create({
    data: {
      tenantId: id,
      employeeId: employee.id,
      action: "impersonate",
      entityType: "employee",
      entityId: employee.id,
      changes: {
        adminEmail: session.email,
        adminName: session.name,
        adminRole: session.role,
        targetOrg: org.name,
        targetEmployee: `${employee.lastName} ${employee.firstName}`,
        targetRole: employee.role,
      },
    },
  })

  // Создать NextAuth JWT-токен для сотрудника
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) {
    return NextResponse.json({ error: "NEXTAUTH_SECRET not configured" }, { status: 500 })
  }

  const token = await encode({
    secret,
    token: {
      sub: employee.id,
      name: `${employee.lastName} ${employee.firstName}`,
      email: employee.email,
      role: employee.role,
      tenantId: id,
      employeeId: employee.id,
      orgName: org.name,
      billingStatus: org.billingStatus,
      instructorsSeePhones: org.instructorsSeePhones,
      // Зоны видимости по филиалам под ролью сотрудника (ADM-04).
      allowedBranchIds,
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
    employee: `${employee.lastName} ${employee.firstName}`,
    role: employee.role,
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
