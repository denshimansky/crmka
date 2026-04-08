import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { db } from "@/lib/db"

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json()

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Токен не указан" },
        { status: 400 }
      )
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Пароль должен содержать минимум 6 символов" },
        { status: 400 }
      )
    }

    const verificationToken = await db.verificationToken.findUnique({
      where: { token },
    })

    if (!verificationToken) {
      return NextResponse.json(
        { error: "Недействительная или просроченная ссылка" },
        { status: 400 }
      )
    }

    if (verificationToken.expires < new Date()) {
      // Clean up expired token
      await db.verificationToken.delete({
        where: { token },
      })
      return NextResponse.json(
        { error: "Ссылка для сброса пароля истекла" },
        { status: 400 }
      )
    }

    const employee = await db.employee.findFirst({
      where: {
        email: verificationToken.identifier,
        isActive: true,
        deletedAt: null,
      },
    })

    if (!employee) {
      await db.verificationToken.delete({
        where: { token },
      })
      return NextResponse.json(
        { error: "Пользователь не найден" },
        { status: 400 }
      )
    }

    const passwordHash = await bcrypt.hash(password, 10)

    await db.employee.update({
      where: { id: employee.id },
      data: { passwordHash },
    })

    // Delete used token
    await db.verificationToken.delete({
      where: { token },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[reset-password] error:", error)
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    )
  }
}
