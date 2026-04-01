import { NextRequest, NextResponse } from "next/server"
import { authenticateByToken, getPortalSession } from "@/lib/portal-auth"

// POST /api/portal/auth?token=xxx — авторизация по токену
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get("token")
  if (!token) {
    return NextResponse.json({ error: "Токен не указан" }, { status: 400 })
  }

  const result = await authenticateByToken(token)
  if (!result) {
    return NextResponse.json({ error: "Недействительная ссылка" }, { status: 401 })
  }

  const response = NextResponse.json({
    client: result.portal,
    pdnConsent: result.pdnConsent,
  })
  response.cookies.set("portal-token", result.jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 дней
    path: "/",
  })

  return response
}

// GET /api/portal/auth — проверка сессии
export async function GET() {
  const session = await getPortalSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json({ client: session })
}

// DELETE /api/portal/auth — выход
export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set("portal-token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
  return response
}
