import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { extCorsHeaders, readExtJson } from "../lib/ext-cors"

// CORS поверхности /api/ext/* — не граница безопасности (её держит PAT-токен),
// но именно он решает, сможет ли страница мессенджера прочитать наш ответ.
// Список источников узкий и растёт вместе с каналами, поэтому фиксируем его
// тестом: молча потерянный origin выглядит как «расширение сломалось».

function req(origin: string | null, init?: RequestInit) {
  return new Request("https://msk1.umnayacrm.ru/api/ext/resolve", {
    ...init,
    headers: origin ? { origin } : {},
  })
}

describe("extCorsHeaders — кому разрешаем читать ответ", () => {
  it("хосты веб-мессенджеров разрешены", () => {
    for (const origin of [
      "https://web.telegram.org",
      "https://web.max.ru",
      "https://web.whatsapp.com",
      "https://vk.com",
      "https://vk.ru",
      "https://web.vk.me",
    ]) {
      assert.equal(
        extCorsHeaders(req(origin))["Access-Control-Allow-Origin"],
        origin,
        `origin ${origin} должен быть разрешён`,
      )
    }
  })

  it("расширение разрешено по схеме: его id неизвестен до публикации", () => {
    const headers = extCorsHeaders(req("chrome-extension://abcdefghijklmnop"))
    assert.equal(headers["Access-Control-Allow-Origin"], "chrome-extension://abcdefghijklmnop")
  })

  it("чужой источник не получает заголовков вовсе", () => {
    assert.deepEqual(extCorsHeaders(req("https://evil.example")), {})
    // Похожий, но не тот хост — подстроки нам не годятся.
    assert.deepEqual(extCorsHeaders(req("https://web.telegram.org.evil.example")), {})
    assert.deepEqual(extCorsHeaders(req(null)), {})
  })

  it("отвечаем эхом origin, а не «*»: с Authorization звёздочка несовместима", () => {
    const headers = extCorsHeaders(req("https://web.telegram.org"))
    assert.equal(headers["Access-Control-Allow-Credentials"], "false")
    assert.equal(headers.Vary, "Origin")
  })
})

// Битое тело раньше роняло роут в NextResponse-500, а она уходит БЕЗ
// CORS-заголовков — панель видела «ошибку сети» вместо внятного 400.
describe("readExtJson — тело запроса", () => {
  it("корректный JSON разбирается", async () => {
    const body = await readExtJson(
      req("https://web.telegram.org", { method: "POST", body: JSON.stringify({ a: 1 }) }),
    )
    assert.deepEqual(body, { a: 1 })
  })

  it("битый JSON → undefined, а не исключение", async () => {
    const body = await readExtJson(
      req("https://web.telegram.org", { method: "POST", body: "{не json" }),
    )
    assert.equal(body, undefined)
  })

  it("пустое тело → undefined", async () => {
    const body = await readExtJson(req("https://web.telegram.org", { method: "POST" }))
    assert.equal(body, undefined)
  })
})
