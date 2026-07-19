import { NextResponse } from "next/server"
import { getPortalSession, PORTAL_COOKIE_NAME } from "@/lib/portal-auth"

// Вход выполняется по логину/паролю — POST /api/portal/login.
// Здесь остались проверка сессии и выход.

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
  response.cookies.set(PORTAL_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
  return response
}
