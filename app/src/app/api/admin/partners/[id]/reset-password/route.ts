import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { sendMail } from "@/lib/mailer"
import { passwordResetEmail } from "@/lib/email-templates"

// POST /api/admin/partners/[id]/reset-password — ссылка сброса пароля сотруднику
//
// Для случая «владелец забыл пароль, а почта не настроена/не дошла»:
// генерирует ту же ссылку, что и /forgot-password (токен на 1 час), и
// возвращает её админу — передать партнёру любым каналом. Если SMTP настроен
// и у сотрудника есть email — письмо дополнительно отправляется само.
//
// Идентификатор токена — "employee:{id}" (а не email): работает и для
// сотрудников без email (email у рядовых сотрудников опционален).
//
// Body: { employeeId?: string } — по умолчанию owner организации.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "support") {
    return NextResponse.json({ error: "Forbidden: только superadmin и support" }, { status: 403 })
  }

  const { id } = await params

  let employeeId: string | undefined
  try {
    const body = await req.json()
    if (typeof body?.employeeId === "string") employeeId = body.employeeId
  } catch {
    // пустое тело — сбрасываем владельцу
  }

  const employee = await db.employee.findFirst({
    where: employeeId
      ? { id: employeeId, tenantId: id, isActive: true, deletedAt: null }
      : { tenantId: id, role: "owner", isActive: true, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, login: true, role: true },
  })
  if (!employee) {
    return NextResponse.json(
      { error: employeeId ? "Сотрудник не найден или неактивен" : "У организации нет активного владельца" },
      { status: 404 }
    )
  }

  const identifier = `employee:${employee.id}`
  const token = crypto.randomUUID()
  const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 час, как в /forgot-password

  await db.verificationToken.deleteMany({ where: { identifier } })
  await db.verificationToken.create({ data: { identifier, token, expires } })

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"
  const resetUrl = `${baseUrl}/reset-password?token=${token}`

  // Best-effort письмо — ссылку показываем в любом случае
  let emailSent = false
  if (employee.email) {
    const displayName =
      [employee.firstName, employee.lastName].filter(Boolean).join(" ") || undefined
    const { subject, html, text } = passwordResetEmail(resetUrl, displayName)
    emailSent = await sendMail({ to: employee.email, subject, html, text })
  }

  return NextResponse.json({
    resetUrl,
    expiresAt: expires.toISOString(),
    emailSent,
    employee: {
      id: employee.id,
      name: [employee.lastName, employee.firstName].filter(Boolean).join(" "),
      login: employee.login,
      email: employee.email,
      role: employee.role,
    },
  })
}
