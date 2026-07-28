import { html } from "./content.generated"

// Внутренняя методичка по отчётности при пакетном типе (для методолога/владельца).
// Путь НЕ в белом списке middleware → доступ только залогиненным сотрудникам
// (withAuth редиректит анонимов на /login). Наружу не индексируется (robots noindex).
// Контент — self-contained HTML, сгенерирован из docs/package-subscriptions-reports-for-anna.md
// (генератор: scratchpad/build_artifacts.py). Правки — в .md, затем перегенерация.
export const dynamic = "force-dynamic"

export function GET() {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  })
}
