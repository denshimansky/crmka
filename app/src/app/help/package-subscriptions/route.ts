import { html } from "./content.generated"

// Публичная страница-инструкция по пакетным абонементам.
// Путь /help/* исключён из auth-middleware (см. src/middleware.ts) —
// открывается по прямой ссылке без входа в CRM.
// Контент — self-contained HTML, сгенерирован из docs/package-subscriptions-user-guide.md
// (генератор: scratchpad/build_artifacts.py). Правки — в .md, затем перегенерация.
export const dynamic = "force-static"

export function GET() {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  })
}
