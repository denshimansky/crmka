import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

// Read-only режим неплательщика (billingStatus === "blocked"):
// страницы и любое чтение (GET/HEAD/OPTIONS) работают, мутации к /api/*
// блокируются с 403, кроме белого списка — того, что нужно, чтобы
// «посмотреть и оплатить». Красную плашку рисует BillingBanner.
//
// Ограничение: enforcement идёт по JWT, который рефрешится из БД раз в
// ~5 минут (lib/auth.ts) — блокировка/разблокировка применяется с задержкой
// до 5 минут. Плашка при этом живая (fetch /api/billing-status) и
// обновляется сразу.
const WRITE_ALLOWED_FOR_BLOCKED: { prefix: string; methods: "all" | string[] }[] = [
  // Биллинг: смена периода оплаты (PUT /api/billing); префикс покрывает
  // и /api/billing-status, и PDF счетов
  { prefix: "/api/billing", methods: "all" },
  // Логин/логаут (исключён matcher-ом, оставлен для надёжности)
  { prefix: "/api/auth", methods: "all" },
  // Отметить уведомления прочитанными / удалить; создание (POST) — закрыто
  { prefix: "/api/notifications", methods: ["PUT", "DELETE"] },
  // Телеметрия навигации из layout — безвредна, ошибки в ней глотаются
  { prefix: "/api/analytics/pageview", methods: ["POST"] },
]

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

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

    if (
      billingStatus === "blocked" &&
      pathname.startsWith("/api/") &&
      !READ_METHODS.has(req.method)
    ) {
      const allowed = WRITE_ALLOWED_FOR_BLOCKED.some(
        (rule) =>
          pathname.startsWith(rule.prefix) &&
          (rule.methods === "all" || rule.methods.includes(req.method))
      )
      if (!allowed) {
        return NextResponse.json(
          {
            error:
              "Счёт не оплачен — CRM в режиме просмотра. Изменения недоступны, перейдите в раздел «Подписка».",
            code: "BILLING_READ_ONLY",
          },
          { status: 403 }
        )
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
    "/((?!login|offer|lp|help|testing|bugs|forgot-password|reset-password|roadmap|reps|changelog|dev|admin|portal|p/|api/auth|api/admin|api/portal|api/cron|api/kb/media|_next/static|_next/image|favicon.ico|manifest|sw|icons).*)",
  ],
}
