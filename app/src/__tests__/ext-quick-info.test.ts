import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  formatBalanceText,
  formatLessonDate,
  formatLessonLine,
  formatRoom,
  formatScheduleText,
  formatSubscriptionsText,
} from "@/lib/ext/quick-info"

// Этот текст уходит РОДИТЕЛЮ в мессенджер: ошибка тут видна не нам, а клиенту
// центра. Поэтому формулировки и формат зафиксированы тестами.

describe("formatLessonDate", () => {
  it("день недели считается по дате, а не по зоне браузера", () => {
    // 1 сентября 2026 — вторник.
    assert.equal(formatLessonDate("2026-09-01"), "01.09 (вт)")
  })
  it("воскресенье", () => {
    assert.equal(formatLessonDate("2026-09-06"), "06.09 (вс)")
  })
  it("лишний хвост ISO игнорируется", () => {
    assert.equal(formatLessonDate("2026-09-06T00:00:00.000Z"), "06.09 (вс)")
  })
})

describe("formatLessonLine", () => {
  it("направление и кабинет", () => {
    assert.equal(
      formatLessonLine({
        date: "2026-09-01",
        startTime: "17:00",
        direction: "Ментальная арифметика",
        room: "Синий",
      }),
      "01.09 (вт) 17:00 — Ментальная арифметика, каб. Синий",
    )
  })
  it("без кабинета", () => {
    assert.equal(
      formatLessonLine({ date: "2026-09-01", startTime: "17:00", direction: "Развивайка", room: null }),
      "01.09 (вт) 17:00 — Развивайка",
    )
  })
  it("совсем без подробностей — только дата и время", () => {
    assert.equal(
      formatLessonLine({ date: "2026-09-01", startTime: "17:00", direction: null, room: null }),
      "01.09 (вт) 17:00",
    )
  })
})

describe("formatScheduleText", () => {
  const lessons = [
    { date: "2026-09-01", startTime: "17:00", direction: "Развивайка", room: null },
    { date: "2026-09-03", startTime: "17:00", direction: "Развивайка", room: null },
  ]

  it("один ребёнок — без имени в заголовке", () => {
    assert.equal(
      formatScheduleText([{ name: "Дима", lessons }], { showNames: false }),
      "Ближайшие занятия:\n01.09 (вт) 17:00 — Развивайка\n03.09 (чт) 17:00 — Развивайка",
    )
  })

  it("несколько детей — каждый своим блоком с именем", () => {
    const text = formatScheduleText(
      [
        { name: "Дима", lessons: lessons.slice(0, 1) },
        { name: "Маша", lessons: lessons.slice(1) },
      ],
      { showNames: true },
    )
    assert.equal(
      text,
      "Ближайшие занятия, Дима:\n01.09 (вт) 17:00 — Развивайка\n\n" +
        "Ближайшие занятия, Маша:\n03.09 (чт) 17:00 — Развивайка",
    )
  })

  it("ребёнок без занятий не порождает пустой заголовок", () => {
    assert.equal(
      formatScheduleText(
        [{ name: "Дима", lessons }, { name: "Маша", lessons: [] }],
        { showNames: true },
      ),
      "Ближайшие занятия, Дима:\n01.09 (вт) 17:00 — Развивайка\n03.09 (чт) 17:00 — Развивайка",
    )
  })

  it("занятий нет вовсе — вставлять нечего", () => {
    assert.equal(formatScheduleText([{ name: "Дима", lessons: [] }], { showNames: false }), null)
  })
})

describe("formatSubscriptionsText", () => {
  // Intl ru-RU разделяет тысячи неразрывным пробелом — нормализуем, как в currency.test.ts.
  const norm = (s: string | null) => s?.replace(/\s/g, " ") ?? null

  const sub = {
    direction: "Ментальная арифметика",
    periodYear: 2026,
    periodMonth: 9,
    totalLessons: 8,
    remainingLessons: 5,
    debt: 0,
  }

  it("месяц словом в предложном падеже", () => {
    assert.equal(
      formatSubscriptionsText([{ name: "Дима", subscriptions: [sub] }], { showNames: false }),
      "Ментальная арифметика в сентябре: оплачено 8 занятий, осталось 5.",
    )
  })

  it("долг показываем, когда он есть", () => {
    assert.equal(
      norm(
        formatSubscriptionsText([{ name: "Дима", subscriptions: [{ ...sub, debt: 1500 }] }], {
          showNames: false,
        }),
      ),
      "Ментальная арифметика в сентябре: оплачено 8 занятий, осталось 5. К оплате 1 500 ₽.",
    )
  })

  it("пакетный абонемент — без месяца (периода у него нет)", () => {
    assert.equal(
      formatSubscriptionsText(
        [{ name: "Дима", subscriptions: [{ ...sub, periodYear: null, periodMonth: null }] }],
        { showNames: false },
      ),
      "Ментальная арифметика: оплачено 8 занятий, осталось 5.",
    )
  })

  it("несколько детей — с именами", () => {
    assert.equal(
      formatSubscriptionsText(
        [
          { name: "Дима", subscriptions: [sub] },
          { name: "Маша", subscriptions: [{ ...sub, direction: "Развивайка" }] },
        ],
        { showNames: true },
      ),
      "Дима, Ментальная арифметика в сентябре: оплачено 8 занятий, осталось 5.\n" +
        "Маша, Развивайка в сентябре: оплачено 8 занятий, осталось 5.",
    )
  })

  it("активных абонементов нет — кнопки не будет", () => {
    assert.equal(formatSubscriptionsText([{ name: "Дима", subscriptions: [] }], { showNames: false }), null)
  })
})

describe("formatBalanceText", () => {
  const norm = (s: string) => s.replace(/\s/g, " ")

  it("минус на балансе — это долг", () => {
    assert.equal(norm(formatBalanceText(-1500)), "Задолженность: 1 500 ₽.")
  })
  it("плюс — деньги вперёд", () => {
    assert.equal(norm(formatBalanceText(1200)), "На балансе: 1 200 ₽.")
  })
  it("ноль", () => {
    assert.equal(formatBalanceText(0), "На балансе: 0.")
  })
  it("валюта организации подставляется", () => {
    assert.equal(norm(formatBalanceText(1200, "KZT")), "На балансе: 1 200 ₸.")
  })
})

describe("formatSubscriptionsText — склонение «занятий»", () => {
  const base = {
    direction: "Развивайка",
    periodYear: 2026,
    periodMonth: 9,
    remainingLessons: 1,
    debt: 0,
  }

  it("одно занятие", () => {
    assert.equal(
      formatSubscriptionsText([{ name: "Дима", subscriptions: [{ ...base, totalLessons: 1 }] }], {
        showNames: false,
      }),
      "Развивайка в сентябре: оплачено 1 занятие, осталось 1.",
    )
  })

  it("два-четыре — «занятия»", () => {
    assert.equal(
      formatSubscriptionsText([{ name: "Дима", subscriptions: [{ ...base, totalLessons: 3 }] }], {
        showNames: false,
      }),
      "Развивайка в сентябре: оплачено 3 занятия, осталось 1.",
    )
  })

  it("одиннадцать — исключение из правила «оканчивается на 1»", () => {
    assert.equal(
      formatSubscriptionsText([{ name: "Дима", subscriptions: [{ ...base, totalLessons: 11 }] }], {
        showNames: false,
      }),
      "Развивайка в сентябре: оплачено 11 занятий, осталось 1.",
    )
  })

  it("двадцать одно — снова «занятие»", () => {
    assert.equal(
      formatSubscriptionsText([{ name: "Дима", subscriptions: [{ ...base, totalLessons: 21 }] }], {
        showNames: false,
      }),
      "Развивайка в сентябре: оплачено 21 занятие, осталось 1.",
    )
  })
})

describe("formatRoom", () => {
  it("обычное название получает приписку", () => {
    assert.equal(formatRoom("Синий"), "каб. Синий")
  })
  it("«1 кабинет» не превращаем в «каб. 1 кабинет»", () => {
    assert.equal(formatRoom("1 кабинет"), "1 кабинет")
  })
  it("«Кабинет 2» — тоже как есть", () => {
    assert.equal(formatRoom("Кабинет 2"), "Кабинет 2")
  })
  it("пусто — строки не будет", () => {
    assert.equal(formatRoom(null), null)
    assert.equal(formatRoom("   "), null)
  })
})
