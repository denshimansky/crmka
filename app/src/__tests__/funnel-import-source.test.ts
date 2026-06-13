/**
 * Регрессия: контакты массового импорта (Client.source='import') НЕ считаются
 * «новыми лидами месяца» в воронке продаж (этап «Лид»), а созданные вручную —
 * считаются. Баг: импорт исторической базы (createdAt = дата импорта) раздувал
 * вершину воронки (см. lib/reports/sales-funnel.ts, docs/reports-logic.md CRM-13).
 *
 * Через HTTP на dev-сервере (как trial-funnel.test.ts). Скип без seed/auth.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "./helpers"

const BASE_URL = process.env.TEST_BASE_URL || "https://dev.umnayacrm.ru"

// Счётчик этапа «Лид» воронки за текущий месяц (без параметров = текущий месяц).
async function leadCount(cookie: string): Promise<number> {
  const res = await apiCall("GET", "/api/reports/funnel", { cookie })
  const funnel: any[] = res.data?.data?.funnel ?? []
  const lead = funnel.find((s) => s.status === "lead")
  return lead ? Number(lead.count) : NaN
}

// Поиск id клиента по телефону (для очистки импортированного — endpoint импорта
// возвращает только счётчики, не id). Шейп ответа /api/clients нормализуем мягко.
async function findClientIdByPhone(cookie: string, phone: string): Promise<string | null> {
  const res = await apiCall("GET", `/api/clients?search=${encodeURIComponent(phone)}`, { cookie })
  const list: any[] = Array.isArray(res.data)
    ? res.data
    : (res.data?.data ?? res.data?.clients ?? [])
  const tail = phone.replace(/\D/g, "").slice(-7)
  const found = list.find((c) => (c.phone ?? "").replace(/\D/g, "").endsWith(tail))
  return found?.id ?? list[0]?.id ?? null
}

describe("Воронка: импортированные контакты не считаются лидами", () => {
  let cookie: string | null = null
  let manualId: string | null = null
  let importedId: string | null = null

  before(async () => {
    cookie = await getAuthCookie("owner")
  })

  it("ручной лид → +1 к «Лид»; импортированный → +0", async (t) => {
    if (!cookie) { t.skip("Auth недоступна (seed не применён?)"); return }
    const c = cookie
    const suffix = Date.now().toString().slice(-7)

    const base = await leadCount(c)
    if (Number.isNaN(base)) { t.skip("Воронка недоступна"); return }

    // 1) Ручной лид (quick-create, source=manual по умолчанию) — +1 к «Лид».
    const manualPhone = `+7901${suffix}`
    const manualRes = await apiCall("POST", "/api/clients", {
      cookie: c,
      body: { firstName: "Ручной", lastName: `Лид${suffix}`, phone: manualPhone },
    })
    assert.equal(manualRes.status, 201, `ручной лид создан: ${JSON.stringify(manualRes.data)}`)
    manualId = manualRes.data.id
    const afterManual = await leadCount(c)
    assert.equal(afterManual, base + 1, "ручной лид увеличил «Лид» ровно на 1")

    // 2) Импортированный контакт (CSV-импорт, source=import) — НЕ меняет «Лид».
    const importedPhone = `+7902${suffix}`
    const csv = `Имя;Фамилия;Телефон\nИмпорт;Тест${suffix};${importedPhone}\n`
    const form = new FormData()
    form.append("file", new Blob([csv], { type: "text/csv" }), "import.csv")
    const impRes = await fetch(`${BASE_URL}/api/clients/import`, {
      method: "POST",
      headers: { Cookie: c },
      body: form,
      redirect: "manual",
    })
    const impData = await impRes.json().catch(() => null)
    assert.equal(impRes.status, 200, `импорт выполнен: ${JSON.stringify(impData)}`)
    assert.equal(impData?.imported, 1, "импортирован ровно 1 контакт")

    const afterImport = await leadCount(c)
    assert.equal(afterImport, afterManual, "импортированный контакт НЕ увеличил «Лид»")

    importedId = await findClientIdByPhone(c, importedPhone)
  })

  after(async () => {
    if (!cookie) return
    if (manualId) await apiCall("DELETE", `/api/clients/${manualId}`, { cookie })
    if (importedId) await apiCall("DELETE", `/api/clients/${importedId}`, { cookie })
  })
})
