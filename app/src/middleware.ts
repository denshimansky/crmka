import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

// Маршруты, доступные заблокированным тенантам
const ALLOWED_FOR_BLOCKED = ["/billing", "/api/billing", "/api/auth"]

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    if (!token) return NextResponse.next()

    // Проверяем billingStatus из JWT-токена
    const billingStatus = token.billingStatus as string | undefined
    const { pathname } = req.nextUrl

    if (billingStatus === "blocked") {
      const isAllowed = ALLOWED_FOR_BLOCKED.some((prefix) =>
        pathname.startsWith(prefix)
      )

      if (!isAllowed) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Организация заблокирована. Перейдите в раздел Биллинг." },
            { status: 403 }
          )
        }
        const billingUrl = new URL("/billing", req.url)
        return NextResponse.redirect(billingUrl)
      }
    }

    return NextResponse.next()
  },
  {
    pages: {
      signIn: "/login",
    },
  }
)

export const config = {
  matcher: [
    "/((?!login|offer|lp|testing|bugs|forgot-password|reset-password|roadmap|changelog|dev|admin|portal|api/auth|api/admin|api/portal|_next/static|_next/image|favicon.ico|manifest|sw|icons).*)",
  ],
}
