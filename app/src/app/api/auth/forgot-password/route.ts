import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { db } from "@/lib/db"

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email || typeof email !== "string") {
      return NextResponse.json({ ok: true }) // Don't reveal validation details
    }

    const employee = await db.employee.findFirst({
      where: {
        email: email.toLowerCase().trim(),
        isActive: true,
        deletedAt: null,
      },
    })

    if (employee) {
      const token = crypto.randomUUID()
      const expires = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      // Delete any existing tokens for this email
      await db.verificationToken.deleteMany({
        where: { identifier: employee.email! },
      })

      await db.verificationToken.create({
        data: {
          identifier: employee.email!,
          token,
          expires,
        },
      })

      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000"
      const resetUrl = `${baseUrl}/reset-password?token=${token}`

      // TODO: send email. For now, log to console
      console.log(`[Password Reset] URL for ${employee.email}: ${resetUrl}`)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[forgot-password] error:", error)
    return NextResponse.json({ ok: true }) // Don't reveal errors
  }
}
