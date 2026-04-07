import { NextRequest, NextResponse } from "next/server"
import { authenticateAdmin, getAdminSession } from "@/lib/admin-auth"
import { rateLimit, getClientIp } from "@/lib/rate-limit"

// POST /api/admin/auth — логин админа
export async function POST(req: NextRequest) {
  // Rate limit: 5 попыток логина в минуту per IP
  const ip = getClientIp(req)
  const rl = rateLimit(`admin-auth:${ip}`, { maxRequests: 5, windowMs: 60_000 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Слишком много попыток. Повторите через ${rl.retryAfter} сек.` },
      { status: 429 }
    )
  }

  const body = await req.json()
  const { email, password } = body

  if (!email || !password) {
    return NextResponse.json({ error: "Email и пароль обязательны" }, { status: 400 })
  }

  const result = await authenticateAdmin(email, password)
  if (!result) {
    return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 })
  }

  const response = NextResponse.json({ admin: result.admin })
  response.cookies.set("admin-token", result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 24h
    path: "/",
  })

  return response
}

// GET /api/admin/auth — проверка сессии
export async function GET() {
  const session = await getAdminSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json({ admin: session })
}

// DELETE /api/admin/auth — выход
export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set("admin-token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
  return response
}
