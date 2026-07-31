import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { wasEverClient } from "../lib/clients/was-ever-client"

describe("wasEverClient", () => {
  const base = { firstPaymentDate: null, firstPaidLessonDate: null, clientStatus: null }

  it("чистый лид — false", () => {
    assert.equal(wasEverClient(base), false)
  })
  it("была первая оплата — true", () => {
    assert.equal(wasEverClient({ ...base, firstPaymentDate: new Date("2026-07-01") }), true)
  })
  it("было первое платное занятие (в т.ч. в долг) — true", () => {
    assert.equal(wasEverClient({ ...base, firstPaidLessonDate: new Date("2026-07-28") }), true)
  })
  it("сейчас активный — true", () => {
    assert.equal(wasEverClient({ ...base, clientStatus: "active" }), true)
  })
  it("сейчас выбывший — true", () => {
    assert.equal(wasEverClient({ ...base, clientStatus: "churned" }), true)
  })
})
