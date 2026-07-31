import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { planFormerClientTransition } from "../lib/clients/former-client-status"

const client = (over: Partial<{ funnelStatus: string; clientStatus: string | null; firstPaymentDate: Date | null; firstPaidLessonDate: Date | null }>) => ({
  funnelStatus: "active_client",
  clientStatus: null,
  firstPaymentDate: null,
  firstPaidLessonDate: new Date("2026-07-28"), // по умолчанию — бывший клиент
  ...over,
})

describe("planFormerClientTransition", () => {
  it("R1: бывшего клиента нельзя в Потенциальный", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "non_target" }),
      patchFunnelStatus: "potential",
      role: "owner",
    })
    assert.deepEqual(r, { error: "Бывшего клиента нельзя вернуть в «Потенциальный»", httpStatus: 400 })
  })

  it("R1: чистый лид → Потенциальный разрешено", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "new", firstPaidLessonDate: null }),
      patchFunnelStatus: "potential",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: false })
  })

  it("R1: уже Потенциальный, no-op сохранение — разрешено", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "potential" }),
      patchFunnelStatus: "potential",
      role: "owner",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: false })
  })

  it("R2: churned из ЧС под владельцем → вывод в active_client, clientStatus не чистим", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "blacklisted" }),
      patchClientStatus: "churned",
      role: "owner",
    })
    assert.deepEqual(r, { funnelStatusInject: "active_client", clearClientStatus: false })
  })

  it("R2: churned из Архива под управляющим → active_client", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "archived" }),
      patchClientStatus: "churned",
      role: "manager",
    })
    assert.deepEqual(r, { funnelStatusInject: "active_client", clearClientStatus: false })
  })

  it("R2: churned из ЧС под админом → 403", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "blacklisted" }),
      patchClientStatus: "churned",
      role: "admin",
    })
    assert.deepEqual(r, { error: "Только владелец или управляющий может вывести клиента из чёрного списка или архива", httpStatus: 403 })
  })

  it("churned НЕ из терминала (обычное отчисление) — без инъекции", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "active" }),
      patchClientStatus: "churned",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: false })
  })

  it("бывший выбывший → Лид: чистим clientStatus", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "churned" }),
      patchFunnelStatus: "new",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: true })
  })

  it("бывший выбывший → Не целевой: чистим clientStatus", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "churned" }),
      patchFunnelStatus: "non_target",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: true })
  })

  it("вход в ЧС (archived/blacklisted) — чистим clientStatus (как раньше)", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "active" }),
      patchFunnelStatus: "blacklisted",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: true })
  })

  it("явный clientStatus в теле → clientStatus не чистим", () => {
    const r = planFormerClientTransition({
      existing: client({ funnelStatus: "active_client", clientStatus: "churned" }),
      patchFunnelStatus: "new",
      patchClientStatus: "active",
      role: "admin",
    })
    assert.deepEqual(r, { funnelStatusInject: null, clearClientStatus: false })
  })
})
