import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { rateLimit, getClientIp } from "@/lib/rate-limit"

describe("rateLimit", () => {
  it("разрешает запросы в пределах лимита", () => {
    const key = `test-allow-${Date.now()}`
    for (let i = 0; i < 5; i++) {
      const result = rateLimit(key, { maxRequests: 5, windowMs: 10_000 })
      assert.equal(result.ok, true, `Запрос ${i + 1} должен быть разрешён`)
    }
  })

  it("блокирует после превышения лимита", () => {
    const key = `test-block-${Date.now()}`
    // Исчерпываем лимит
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { maxRequests: 3, windowMs: 60_000 })
    }
    // Следующий должен быть заблокирован
    const result = rateLimit(key, { maxRequests: 3, windowMs: 60_000 })
    assert.equal(result.ok, false)
    assert.ok(result.retryAfter, "retryAfter должен быть указан")
    assert.ok(result.retryAfter! > 0, "retryAfter > 0")
  })

  it("разные ключи независимы", () => {
    const keyA = `test-indep-a-${Date.now()}`
    const keyB = `test-indep-b-${Date.now()}`
    // Исчерпываем лимит для A
    for (let i = 0; i < 3; i++) {
      rateLimit(keyA, { maxRequests: 3, windowMs: 60_000 })
    }
    const blockedA = rateLimit(keyA, { maxRequests: 3, windowMs: 60_000 })
    assert.equal(blockedA.ok, false, "A заблокирован")

    // B должен работать
    const allowedB = rateLimit(keyB, { maxRequests: 3, windowMs: 60_000 })
    assert.equal(allowedB.ok, true, "B разрешён")
  })

  it("дефолтные параметры (10 запросов, 60с)", () => {
    const key = `test-defaults-${Date.now()}`
    for (let i = 0; i < 10; i++) {
      const r = rateLimit(key)
      assert.equal(r.ok, true)
    }
    const blocked = rateLimit(key)
    assert.equal(blocked.ok, false)
  })
})

describe("getClientIp", () => {
  it("извлекает IP из x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    })
    assert.equal(getClientIp(req), "1.2.3.4")
  })

  it("извлекает IP из x-real-ip", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "10.0.0.1" },
    })
    assert.equal(getClientIp(req), "10.0.0.1")
  })

  it("x-forwarded-for приоритетнее x-real-ip", () => {
    const req = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "1.1.1.1",
        "x-real-ip": "2.2.2.2",
      },
    })
    assert.equal(getClientIp(req), "1.1.1.1")
  })

  it("возвращает 'unknown' без заголовков", () => {
    const req = new Request("http://localhost")
    assert.equal(getClientIp(req), "unknown")
  })
})
