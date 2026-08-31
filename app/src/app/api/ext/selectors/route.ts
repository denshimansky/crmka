import { NextRequest } from "next/server"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions } from "@/lib/ext-cors"
import { buildSelectorConfig } from "@/lib/ext/selector-config"

/**
 * GET /api/ext/selectors
 *
 * Удалённый конфиг селекторов адаптеров (docs/messenger-extension.md §3, Шаг 4
 * Фазы 4). Позволяет починить сломавшийся канал правкой на сервере, без
 * публикации новой версии расширения в Chrome Web Store — там ревью занимает
 * дни, и всё это время канал не работал бы у всех сотрудников сразу.
 *
 * Отдаём ТОЛЬКО переопределения (в норме пустой объект): встроенные в
 * расширение значения остаются источником правды, пока мы явно не скажем иначе.
 * Почему так — в шапке lib/ext/selector-config.ts.
 *
 * Под токеном, как и остальные /api/ext/*: секрета в селекторах нет, но и новой
 * анонимной поверхности заводить незачем. Токена нет или сеть недоступна —
 * расширение работает на встроенных селекторах, это штатный путь.
 */
export const OPTIONS = extOptions

export async function GET(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.read")
  if (!guard.ok) return guard.response

  return extJson(req, buildSelectorConfig())
}
