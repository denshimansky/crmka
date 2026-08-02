import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { db } from "@/lib/db"
import { sendMail } from "@/lib/mailer"
import { passwordResetEmail } from "@/lib/email-templates"

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email || typeof email !== "string") {
      return NextResponse.json({ ok: true }) // Don't reveal validation details
    }

    // Регистро-/пробелонезависимый матч email (как при входе): у части учёток
    // email хранится с заглавными, а вводят строчными. mode:insensitive + точная
    // JS-сверка (ILIKE трактует '_' как wildcard).
    const wanted = email.trim().toLowerCase()
    const candidates = await db.employee.findMany({
      where: {
        email: { equals: email.trim(), mode: "insensitive" },
        isActive: true,
        deletedAt: null,
      },
    })
    // Email уникален лишь В РАМКАХ ЦЕНТРА — один адрес может числиться в
    // нескольких центрах. Шлём отдельную ссылку на КАЖДУЮ учётку с этим email.
    // Идентификатор токена — "employee:{id}" (однозначно резолвится по id в
    // reset-password), а не сам email: identifier=email при дубле уводил бы сброс
    // в произвольную учётку (тот же класс, что исходный баг Валерии).
    const matches = candidates.filter((e) => (e.email ?? "").trim().toLowerCase() === wanted)

    for (const employee of matches) {
      const token = crypto.randomUUID()
      const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
      const identifier = `employee:${employee.id}`

      // Инвалидируем прежние токены именно этой учётки
      await db.verificationToken.deleteMany({ where: { identifier } })
      await db.verificationToken.create({ data: { identifier, token, expires } })

      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"
      const resetUrl = `${baseUrl}/reset-password?token=${token}`

      const displayName = [employee.firstName, employee.lastName].filter(Boolean).join(" ") || undefined
      const { subject, html, text } = passwordResetEmail(resetUrl, displayName)

      const sent = await sendMail({ to: employee.email!, subject, html, text })
      if (!sent) {
        // Фолбэк для dev-среды без SMTP — линк попадает в логи, чтобы можно было войти вручную
        console.log(`[Password Reset] URL for ${employee.email}: ${resetUrl}`)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[forgot-password] error:", error)
    return NextResponse.json({ ok: true }) // Don't reveal errors
  }
}
