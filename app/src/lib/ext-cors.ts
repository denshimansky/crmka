import { NextResponse } from "next/server"

/**
 * CORS для поверхности /api/ext/* (браузерное расширение-панель, см.
 * docs/messenger-extension.md).
 *
 * Зачем: запросы идут со страницы мессенджера (web.telegram.org и др.), то есть
 * это кросс-доменные запросы к домену CRMka. В next.config.ts заголовков
 * Access-Control-* нет вовсе, и добавлять их глобально нельзя — открывать весь
 * API наружу мы не хотим. Поэтому строгий allow-list только здесь.
 *
 * Важно: CORS — не механизм авторизации. Он лишь разрешает браузеру прочитать
 * ответ; сама защита — PAT-токен в requireExtAuth. Поэтому список источников
 * держим узким, но и не считаем его границей безопасности.
 *
 * Про chrome-extension://: фоновый service worker расширения шлёт запросы со
 * своим Origin вида chrome-extension://<id>, а он неизвестен до публикации.
 * Такие запросы разрешаем по схеме, а не по конкретному id — читать ответ
 * всё равно сможет только владелец валидного токена.
 */

/** Хосты веб-мессенджеров, поверх которых работает панель. */
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  // Telegram — первый канал (оба клиента живут на одном хосте: /k и /a).
  "https://web.telegram.org",
  // MAX — следующий по приоритету.
  "https://web.max.ru",
  // WhatsApp.
  "https://web.whatsapp.com",
  // ВК: личные сообщения, сообщения сообществ и отдельный веб-мессенджер.
  "https://vk.com",
  "https://vk.ru",
  "https://web.vk.me",
])

/** Схемы расширений: конкретный id неизвестен до публикации в сторе. */
const ALLOWED_ORIGIN_SCHEMES = ["chrome-extension://", "moz-extension://", "safari-web-extension://"]

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false
  if (ALLOWED_ORIGINS.has(origin)) return true
  return ALLOWED_ORIGIN_SCHEMES.some((scheme) => origin.startsWith(scheme))
}

/**
 * Заголовки CORS для ответа. Origin эхо-ответом (а не «*»), потому что «*»
 * несовместим с заголовком Authorization в некоторых конфигурациях и мешает
 * различать источники в логах. Если источник не из списка — заголовков нет,
 * и браузер сам не отдаст ответ странице.
 */
export function extCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin")
  if (!isAllowedOrigin(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "false",
    Vary: "Origin",
  }
}

/**
 * Ответ на preflight OPTIONS. Каждый роут /api/ext/* должен экспортировать:
 *
 *   export const OPTIONS = extOptions
 */
export function extOptions(req: Request): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...extCorsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  })
}

/** JSON-ответ роута /api/ext/* с CORS-заголовками. */
export function extJson(req: Request, data: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: extCorsHeaders(req),
  })
}
