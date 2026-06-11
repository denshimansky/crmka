/**
 * Воронка «Продажи» — пробные занятия.
 * Правило: одна заявка = одно активное (scheduled) пробное.
 * После «Не пришёл» перезапись разрешена, неявка остаётся в истории.
 * Через HTTP на dev-сервере (как reports.test.ts). Скипаются без seed/auth.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "./helpers"

let ownerCookie: string | null = null
let applicationId: string | null = null
let createdClientId: string | null = null
let trial1Id: string | null = null

function isoDatePlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

async function firstOf(path: string, cookie: string): Promise<any | null> {
  const res = await apiCall("GET", path, { cookie })
  return Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null
}

describe("Пробные: одна заявка = одно активное пробное", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  it("дубль по заявке → 409; после «Не пришёл» — можно; неявка сохраняется", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const cookie = ownerCookie

    // Справочники
    const branch = await firstOf("/api/branches", cookie)
    const direction = await firstOf("/api/directions", cookie)
    const room = await firstOf("/api/rooms", cookie)
    const employeesRes = await apiCall("GET", "/api/employees", { cookie })
    const employees: any[] = Array.isArray(employeesRes.data) ? employeesRes.data : []
    const instructor = employees.find((e) => e.role === "instructor") ?? employees[0]
    if (!branch || !direction || !room || !instructor) {
      t.skip("Нет справочных данных (seed не применён)")
      return
    }

    // Лид с подопечным
    const suffix = Date.now().toString().slice(-7)
    const clientRes = await apiCall("POST", "/api/clients", {
      cookie,
      body: {
        firstName: "Тест",
        lastName: `ОдноПробное${suffix}`,
        phone: `+7999${suffix}`,
        branchId: branch.id,
        wards: [{ firstName: "Ребёнок", lastName: `Тестовый${suffix}` }],
      },
    })
    assert.equal(clientRes.status, 201, `клиент создан: ${JSON.stringify(clientRes.data)}`)
    const clientId = clientRes.data.id
    createdClientId = clientId
    const wardId = clientRes.data.wards?.[0]?.id
    assert.ok(wardId, "у клиента есть подопечный")

    // Заявка
    const appRes = await apiCall("POST", "/api/applications", {
      cookie,
      body: { clientId, wardId, branchId: branch.id, directionId: direction.id },
    })
    assert.ok(appRes.status === 200 || appRes.status === 201, `заявка создана: ${JSON.stringify(appRes.data)}`)
    applicationId = appRes.data.id

    // Индивидуальное пробное (без группы): направление + педагог + кабинет + время
    const trialBody = (date: string, time: string) => ({
      clientId,
      wardId,
      applicationId,
      directionId: direction.id,
      instructorId: instructor.id,
      roomId: room.id,
      startTime: time,
      scheduledDate: date,
    })

    // Первое пробное — ок
    const trial1Res = await apiCall("POST", "/api/trial-lessons", {
      cookie,
      body: trialBody(isoDatePlus(7), "10:00"),
    })
    assert.equal(trial1Res.status, 201, `первое пробное создано: ${JSON.stringify(trial1Res.data)}`)
    trial1Id = trial1Res.data.id

    // Второе по той же заявке (другая дата) — 409 «одна заявка = одно пробное»
    const dupRes = await apiCall("POST", "/api/trial-lessons", {
      cookie,
      body: trialBody(isoDatePlus(8), "11:00"),
    })
    assert.equal(dupRes.status, 409, `дубль отклонён: ${JSON.stringify(dupRes.data)}`)
    assert.match(String(dupRes.data?.error ?? ""), /уже назначено пробное/)

    // «Не пришёл» — заявка остаётся на «Пробном», перезапись разрешена
    const noShowRes = await apiCall("PATCH", `/api/trial-lessons/${trial1Id}`, {
      cookie,
      body: { status: "no_show" },
    })
    assert.equal(noShowRes.status, 200, `неявка отмечена: ${JSON.stringify(noShowRes.data)}`)

    const trial2Res = await apiCall("POST", "/api/trial-lessons", {
      cookie,
      body: trialBody(isoDatePlus(9), "12:00"),
    })
    assert.equal(trial2Res.status, 201, `перезапись после неявки: ${JSON.stringify(trial2Res.data)}`)

    // Старая неявка сохранилась (история + отчёт «Не пришли на пробники»)
    const listRes = await apiCall("GET", `/api/trial-lessons?clientId=${clientId}`, { cookie })
    assert.equal(listRes.status, 200)
    const trials: any[] = Array.isArray(listRes.data) ? listRes.data : []
    assert.equal(trials.find((tr) => tr.id === trial1Id)?.status, "no_show", "неявка осталась no_show")
    assert.equal(trials.find((tr) => tr.id === trial2Res.data.id)?.status, "scheduled", "новое пробное scheduled")
  })

  after(async () => {
    // Best-effort очистка, чтобы не загрязнять demo-тенант:
    // 1) вывод заявки из воронки отменяет её scheduled-пробное;
    // 2) неявку переводим в cancelled — иначе она навсегда останется в отчёте
    //    «Не пришли на пробники» и виджете дашборда;
    // 3) тестового лида мягко удаляем.
    if (!ownerCookie) return
    if (applicationId) {
      await apiCall("POST", `/api/applications/${applicationId}/remove-from-funnel`, {
        cookie: ownerCookie,
      })
    }
    if (trial1Id) {
      await apiCall("PATCH", `/api/trial-lessons/${trial1Id}`, {
        cookie: ownerCookie,
        body: { status: "cancelled" },
      })
    }
    if (createdClientId) {
      await apiCall("DELETE", `/api/clients/${createdClientId}`, { cookie: ownerCookie })
    }
  })
})
