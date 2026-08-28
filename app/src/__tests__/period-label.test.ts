/**
 * Unit-тесты подписи периода абонемента (28.08.2026, баг «undefined null» во
 * вкладке «Посещения» карточки клиента).
 *
 * У ПАКЕТНОГО абонемента period_year/period_month = NULL — период это интервал
 * дат. Места, форматировавшие период как `MONTH[periodMonth] periodYear` без
 * проверки типа, печатали на пакетах буквальное «undefined null».
 *
 * Чистая логика без БД.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { subscriptionPeriodLabel } from "../lib/subscriptions/period-label"

describe("subscriptionPeriodLabel", () => {
  it("календарный абонемент: месяц в трёх форматах", () => {
    const s = { type: "calendar", periodYear: 2026, periodMonth: 8 }
    assert.equal(subscriptionPeriodLabel(s, "numeric"), "08.2026")
    assert.equal(subscriptionPeriodLabel(s, "short"), "авг 2026")
    assert.equal(subscriptionPeriodLabel(s, "long"), "Август 2026")
    // Формат по умолчанию — полный месяц (как на вкладке «Абонементы»).
    assert.equal(subscriptionPeriodLabel(s), "Август 2026")
  })

  it("календарный: однозначный месяц дополняется нулём только в numeric", () => {
    const s = { type: "calendar", periodYear: 2026, periodMonth: 1 }
    assert.equal(subscriptionPeriodLabel(s, "numeric"), "01.2026")
    assert.equal(subscriptionPeriodLabel(s, "short"), "янв 2026")
  })

  it("пакет: интервал дат вместо «undefined null»", () => {
    // Кейс Тарасовой: пакет 03.08–02.09.2026, period_* = null.
    const label = subscriptionPeriodLabel(
      {
        type: "package",
        periodYear: null,
        periodMonth: null,
        startDate: new Date("2026-08-03T00:00:00.000Z"),
        expiresAt: new Date("2026-09-02T00:00:00.000Z"),
      },
      "short",
    )
    assert.equal(label, "03.08.2026 – 02.09.2026")
    assert.ok(!String(label).includes("undefined"))
    assert.ok(!String(label).includes("null"))
  })

  it("пакет: ISO-строки с сервера равносильны Date", () => {
    assert.equal(
      subscriptionPeriodLabel({
        type: "package",
        periodYear: null,
        periodMonth: null,
        startDate: "2026-08-26T00:00:00.000Z",
        expiresAt: "2026-09-25T00:00:00.000Z",
      }),
      "26.08.2026 – 25.09.2026",
    )
  })

  it("пакет: конец берётся из expiresAt (по нему считается покрытие), endDate — фоллбэк", () => {
    assert.equal(
      subscriptionPeriodLabel({
        type: "package",
        periodYear: null,
        periodMonth: null,
        startDate: "2026-08-03T00:00:00.000Z",
        endDate: "2026-08-20T00:00:00.000Z",
        expiresAt: "2026-09-02T00:00:00.000Z",
      }),
      "03.08.2026 – 02.09.2026",
    )
    assert.equal(
      subscriptionPeriodLabel({
        type: "package",
        periodYear: null,
        periodMonth: null,
        startDate: "2026-08-03T00:00:00.000Z",
        endDate: "2026-08-20T00:00:00.000Z",
        expiresAt: null,
      }),
      "03.08.2026 – 20.08.2026",
    )
  })

  it("пакет без одной из границ: односторонняя подпись", () => {
    assert.equal(
      subscriptionPeriodLabel({
        type: "package",
        periodYear: null,
        periodMonth: null,
        startDate: "2026-08-03T00:00:00.000Z",
      }),
      "с 03.08.2026",
    )
    assert.equal(
      subscriptionPeriodLabel({
        type: "package",
        periodYear: null,
        periodMonth: null,
        startDate: null,
        expiresAt: "2026-09-02T00:00:00.000Z",
      }),
      "до 02.09.2026",
    )
  })

  it("null вместо строки, когда данных нет (вызывающий ставит свой фоллбэк)", () => {
    assert.equal(subscriptionPeriodLabel(null), null)
    assert.equal(subscriptionPeriodLabel(undefined), null)
    // Урезанный select: у пакета нет ни дат, ни периода.
    assert.equal(
      subscriptionPeriodLabel({ type: "package", periodYear: null, periodMonth: null }),
      null,
    )
    // Календарный без периода — тоже null, а не «undefined null».
    assert.equal(
      subscriptionPeriodLabel({ type: "calendar", periodYear: null, periodMonth: null }),
      null,
    )
  })

  it("некорректная дата не даёт «Invalid Date» в подписи", () => {
    assert.equal(
      subscriptionPeriodLabel({
        type: "package",
        periodYear: null,
        periodMonth: null,
        startDate: "не дата",
        expiresAt: "2026-09-02T00:00:00.000Z",
      }),
      "до 02.09.2026",
    )
  })
})
