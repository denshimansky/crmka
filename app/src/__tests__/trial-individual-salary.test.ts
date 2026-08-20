/**
 * Пробное БЕЗ группы (индивидуальное): клиенту бесплатно, педагогу — ЗП.
 *
 * Под такое пробное заводится собственное техническое занятие (скрытая
 * группа-держатель, lib/services/trial-holder-lesson) — иначе начислять ЗП
 * некуда: она живёт только в Attendance у Lesson. Проверяем всю цепочку:
 * создание → занятие появилось → кабинет занят → отметка «Был» начислила по
 * ставке → галочка «оплатить» переключает сумму → отмена гасит занятие.
 *
 * Через HTTP на dev-сервере (как reports.test.ts). Скипается без seed/auth.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { getAuthCookie, apiCall } from "./helpers"

const RATE_PER_LESSON = 500

let ownerCookie: string | null = null
let createdClientId: string | null = null
let applicationId: string | null = null
let trialId: string | null = null
let instructorId: string | null = null

function isoDatePlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

describe("Пробное без группы: ЗП инструктору", () => {
  before(async () => {
    ownerCookie = await getAuthCookie("owner")
  })

  it("занятие создаётся, отметка «Был» начисляет по ставке, клиенту 0", async (t) => {
    if (!ownerCookie) { t.skip("Auth недоступна"); return }
    const cookie = ownerCookie

    // Справочники: филиал берём от кабинета, чтобы связка была консистентной.
    const roomsRes = await apiCall("GET", "/api/rooms", { cookie })
    const rooms: any[] = Array.isArray(roomsRes.data) ? roomsRes.data : []
    const room = rooms.find((r) => r.branchId)
    const dirRes = await apiCall("GET", "/api/directions", { cookie })
    const direction = Array.isArray(dirRes.data) ? dirRes.data[0] : null
    if (!room || !direction) {
      t.skip("Нет справочных данных (seed не применён)")
      return
    }

    const suffix = Date.now().toString().slice(-7)

    // Отдельный инструктор со своей ставкой — чтобы не трогать ставки seed-данных.
    const empRes = await apiCall("POST", "/api/employees", {
      cookie,
      body: {
        login: `probzp${suffix}`,
        password: "test123456",
        firstName: "Пробный",
        lastName: `Педагог${suffix}`,
        role: "instructor",
        branchIds: [room.branchId],
      },
    })
    assert.equal(empRes.status, 201, `инструктор создан: ${JSON.stringify(empRes.data)}`)
    instructorId = empRes.data.id

    // Ставка: фикс за занятие + «Все пробные» (начисляем и за бесплатные).
    const rateRes = await apiCall("POST", `/api/employees/${instructorId}/salary-rates`, {
      cookie,
      body: { scheme: "per_lesson", ratePerLesson: RATE_PER_LESSON, trialPayMode: "all" },
    })
    assert.ok(
      rateRes.status === 200 || rateRes.status === 201,
      `ставка задана: ${JSON.stringify(rateRes.data)}`,
    )

    // Лид с ребёнком + заявка (без заявки пробное не создаётся).
    const clientRes = await apiCall("POST", "/api/clients", {
      cookie,
      body: {
        firstName: "Тест",
        lastName: `ПробноеЗП${suffix}`,
        phone: `+7998${suffix}`,
        branchId: room.branchId,
        wards: [{ firstName: "Ребёнок", lastName: `ПробныйЗП${suffix}` }],
      },
    })
    assert.equal(clientRes.status, 201, `лид создан: ${JSON.stringify(clientRes.data)}`)
    createdClientId = clientRes.data.id
    const wardId = clientRes.data.wards?.[0]?.id
    assert.ok(wardId, "у лида есть подопечный")

    const appRes = await apiCall("POST", "/api/applications", {
      cookie,
      body: {
        clientId: createdClientId,
        wardId,
        branchId: room.branchId,
        directionId: direction.id,
      },
    })
    assert.ok(
      appRes.status === 200 || appRes.status === 201,
      `заявка создана: ${JSON.stringify(appRes.data)}`,
    )
    applicationId = appRes.data.id

    // Пробное без группы: направление + инструктор + кабинет + время. Дата
    // далеко впереди и нетипичное время — чтобы не пересечься с реальным
    // расписанием dev-стенда.
    const date = isoDatePlus(60)
    const startTime = "07:05"
    const trialRes = await apiCall("POST", "/api/trial-lessons", {
      cookie,
      body: {
        clientId: createdClientId,
        wardId,
        applicationId,
        directionId: direction.id,
        instructorId,
        roomId: room.id,
        scheduledDate: date,
        startTime,
        durationMinutes: 30,
      },
    })
    assert.equal(trialRes.status, 201, `пробное создано: ${JSON.stringify(trialRes.data)}`)
    trialId = trialRes.data.id

    // Группы у пробного по-прежнему нет, но появилось техническое занятие.
    assert.equal(trialRes.data.groupId, null, "пробное остаётся «без группы»")
    assert.ok(trialRes.data.lessonId, "создано техническое занятие под пробное")
    // Режим ставки «Все пробные» → галочка «оплатить» включена по умолчанию.
    assert.equal(trialRes.data.instructorPayEnabled, true, "оплата инструктору включена по ставке")

    // Кабинет в этот слот занят — разовое занятие туда не встаёт.
    const busyRes = await apiCall("POST", "/api/standalone-lessons", {
      cookie,
      body: {
        branchId: room.branchId,
        roomId: room.id,
        directionId: direction.id,
        instructorId,
        date,
        startTime,
        durationMinutes: 30,
      },
    })
    assert.equal(busyRes.status, 409, `кабинет занят пробным: ${JSON.stringify(busyRes.data)}`)

    // Отметка «Был» — начисление по ставке (клиенту при этом 0: пробное не списывает).
    const attendedRes = await apiCall("PATCH", `/api/trial-lessons/${trialId}`, {
      cookie,
      body: { status: "attended" },
    })
    assert.equal(attendedRes.status, 200, `пробное отмечено: ${JSON.stringify(attendedRes.data)}`)
    assert.equal(
      Number(attendedRes.data.instructorPayAmount),
      RATE_PER_LESSON,
      "ЗП начислена по ставке за занятие",
    )

    // Снятая галочка «оплатить» обнуляет начисление, возвращённая — восстанавливает.
    const offRes = await apiCall("PATCH", `/api/trial-lessons/${trialId}`, {
      cookie,
      body: { instructorPayEnabled: false },
    })
    assert.equal(offRes.status, 200)
    assert.equal(Number(offRes.data.instructorPayAmount), 0, "без галочки ЗП не начисляется")

    const onRes = await apiCall("PATCH", `/api/trial-lessons/${trialId}`, {
      cookie,
      body: { instructorPayEnabled: true },
    })
    assert.equal(onRes.status, 200)
    assert.equal(
      Number(onRes.data.instructorPayAmount),
      RATE_PER_LESSON,
      "галочка вернула начисление",
    )

    // Отмена пробного гасит техническое занятие — кабинет снова свободен.
    const cancelRes = await apiCall("PATCH", `/api/trial-lessons/${trialId}`, {
      cookie,
      body: { status: "cancelled" },
    })
    assert.equal(cancelRes.status, 200, `пробное отменено: ${JSON.stringify(cancelRes.data)}`)

    const freeRes = await apiCall("POST", "/api/standalone-lessons", {
      cookie,
      body: {
        branchId: room.branchId,
        roomId: room.id,
        directionId: direction.id,
        instructorId,
        date,
        startTime,
        durationMinutes: 30,
      },
    })
    assert.equal(
      freeRes.status,
      201,
      `после отмены слот освободился: ${JSON.stringify(freeRes.data)}`,
    )
    // Разовое занятие, созданное проверкой, сразу убираем.
    if (freeRes.data?.id) {
      await apiCall("DELETE", `/api/lessons/${freeRes.data.id}`, { cookie })
    }
  })

  after(async () => {
    // Best-effort очистка demo-тенанта: пробное уже отменено в тесте, заявку
    // выводим из воронки, лида и тестового инструктора удаляем.
    if (!ownerCookie) return
    if (applicationId) {
      await apiCall("POST", `/api/applications/${applicationId}/remove-from-funnel`, {
        cookie: ownerCookie,
      })
    }
    if (trialId) {
      await apiCall("PATCH", `/api/trial-lessons/${trialId}`, {
        cookie: ownerCookie,
        body: { status: "cancelled" },
      })
    }
    if (createdClientId) {
      await apiCall("DELETE", `/api/clients/${createdClientId}`, { cookie: ownerCookie })
    }
    if (instructorId) {
      await apiCall("DELETE", `/api/employees/${instructorId}`, { cookie: ownerCookie })
    }
  })
})
