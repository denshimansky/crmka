import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

// Маршруты, доступные заблокированным тенантам
const ALLOWED_FOR_BLOCKED = ["/billing", "/api/billing", "/api/auth"]

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token
    const { pathname } = req.nextUrl

    // Прокидываем pathname в request headers, чтобы layout серверного компонента
    // мог прочитать его через next/headers и применить permission-гард.
    const requestHeaders = new Headers(req.headers)
    requestHeaders.set("x-pathname", pathname)

    if (!token) {
      return NextResponse.next({ request: { headers: requestHeaders } })
    }

    // Проверяем billingStatus из JWT-токена
    const billingStatus = token.billingStatus as string | undefined

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

    return NextResponse.next({ request: { headers: requestHeaders } })
  },
  {
    pages: {
      signIn: "/login",
    },
  }
)

export const config = {
  matcher: [
    "/((?!login|offer|lp|testing|bugs|forgot-password|reset-password|roadmap|reps|changelog|dev|admin|portal|api/auth|api/admin|api/portal|api/cron|_next/static|_next/image|favicon.ico|manifest|sw|icons).*)",
  ],
}
