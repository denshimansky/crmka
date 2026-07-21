/**
 * Скидки v2 — переключение клиента на «авто» в МЕСЯЦ включения тумблера тип 1.
 *
 * Баг Dream 21.07.2026: тумблер тип 1 включили сегодня (activatedAt = текущий
 * месяц ⇒ по гейту «activatedAt+1» действует со следующего), и в тот же день
 * клиентов перевели с ручной/постоянной скидки на «авто». Для текущего месяца
 * старая скидка снималась с остатка, а тип 1 не подставлялся → на оплаченный
 * абонемент вешался долг (кейс Бабюк/Волковой).
 *
 * Решение владельца: осознанный per-client свитч на «авто» подхватывает тип 1 и
 * в текущем месяце (флаг type1CoversCurrentMonth), гейт остаётся только для
 * массового включения тумблера. Плюс инвариант держится сам, когда в месяце уже
 * есть живой тип-1-абонемент (monthHasType1).
 *
 * Мок-Tx по образцу recalc-on-schedule-change.test.ts: покрывает только тип-1
 * ветку recalcClientDiscounts (клиент без permanent-шаблона, тип 1 включён).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { recalcClientDiscounts } from "../lib/discounts/recalc-client-discounts"

const dec = (x: unknown) => Number(String(x))

// Текущий месяц реального запуска: период абонементов и activatedAt тумблера
// ставим на него, чтобы воспроизвести «включили сегодня» (гейт = следующий месяц).
const NOW = new Date()
const PY = NOW.getFullYear()
const PM = NOW.getMonth() + 1
const activatedThisMonth = new Date(PY, NOW.getMonth(), 1)

// Два равных календарных абонемента текущего месяца, оба уже без скидки
// (source=none — старую сняли). A создан раньше B. Оба отходили 5 из 8.
//   A: оплачен по полной (5×650 + предоплата остатка) → 5200, долга нет;
//   B: был со скидкой −50 (5×600), предоплачен 4800 — из-за снятия скидки на
//      остатке 3 занятия подорожали до 650 и повесили долг 150.
function subs() {
  return [
    {
      id: "A",
      clientId: "c1",
      wardId: "w1",
      groupId: "g1",
      directionId: "d1",
      type: "calendar",
      status: "active",
      periodYear: PY,
      periodMonth: PM,
      lessonPrice: 650,
      totalLessons: 8,
      totalAmount: 5200,
      chargedAmount: 3250,
      discountPerLesson: 0,
      discountSource: "none",
      createdAt: new Date(2026, 6, 7, 10, 37, 36),
    },
    {
      id: "B",
      clientId: "c1",
      wardId: "w1",
      groupId: "g1",
      directionId: "d1",
      type: "calendar",
      status: "active",
      periodYear: PY,
      periodMonth: PM,
      lessonPrice: 650,
      totalLessons: 8,
      totalAmount: 5200,
      chargedAmount: 3000,
      discountPerLesson: 0,
      discountSource: "none",
      createdAt: new Date(2026, 6, 7, 10, 38, 37),
    },
  ]
}

// paidBySub: сколько «оплачено» (transfer_in) вернёт payment.aggregate по абонементу.
function makeTx(opts: {
  subs: any[]
  t1Active?: boolean
  t1ActivatedAt?: Date | null
  attended?: Record<string, number>
  paidBySub?: Record<string, number>
}) {
  const attended = opts.attended ?? { A: 5, B: 5 }
  const paid = opts.paidBySub ?? { A: 5200, B: 4800 }
  const calls = {
    subUpdate: [] as any[],
    discountCreate: [] as any[],
    accountFindFirst: 0,
  }
  const tx: any = {
    client: {
      findFirst: async () => ({
        id: "c1",
        discountTemplateId: null,
        autoDiscountDisabled: false,
      }),
    },
    discountTemplate: {
      // Единственный вызов в этой ветке — системный шаблон тип 1.
      findFirst: async () => ({
        id: "t1",
        name: "Скидка за второй абонемент",
        valueType: "fixed",
        value: 50,
        isActive: opts.t1Active ?? true,
        activatedAt:
          opts.t1ActivatedAt === undefined ? activatedThisMonth : opts.t1ActivatedAt,
      }),
    },
    subscription: {
      findMany: async () => opts.subs,
      update: async (args: any) => {
        calls.subUpdate.push({ id: args.where.id, data: args.data })
        return {}
      },
    },
    attendance: {
      groupBy: async (args: any) => {
        const ids: string[] = args.where.subscriptionId?.in ?? []
        return ids
          .filter((id) => (attended[id] ?? 0) > 0)
          .map((id) => ({ subscriptionId: id, _count: { _all: attended[id] } }))
      },
    },
    payment: {
      aggregate: async (args: any) => ({
        _sum: { amount: paid[args.where.subscriptionId] ?? 0 },
      }),
    },
    discount: {
      updateMany: async () => ({ count: 0 }),
      create: async (args: any) => {
        calls.discountCreate.push(args.data)
        return {}
      },
    },
    financialAccount: {
      findFirst: async () => {
        calls.accountFindFirst++
        return { id: "acc1" }
      },
    },
  }
  return { tx, calls }
}

describe("recalcClientDiscounts — переключение на «авто» в месяц активации тип 1", () => {
  it("с флагом type1CoversCurrentMonth: тип 1 применяется к текущему месяцу (2 абонемента) — долг снят", async () => {
    const { tx, calls } = makeTx({ subs: subs() })
    await recalcClientDiscounts(tx as any, {
      tenantId: "t",
      clientId: "c1",
      type1CoversCurrentMonth: true,
    })

    // Освобождается самый дорогой; при равенстве — более ранний (A). Скидку
    // несёт B (создан позже). Обновляется ровно B.
    assert.equal(calls.subUpdate.length, 1)
    const upd = calls.subUpdate[0]
    assert.equal(upd.id, "B")
    assert.equal(upd.data.discountSource, "type1")
    assert.equal(dec(upd.data.discountPerLesson), 50)
    // final = снимок 3000 + 3 остатка × 600 = 4800; оплачено 4800 → долга нет.
    assert.equal(dec(upd.data.finalAmount), 4800)
    assert.equal(dec(upd.data.balance), 0)
    // discountAmount = 5200 − 4800 = 400 (−50 на все 8 занятий).
    assert.equal(dec(upd.data.discountAmount), 400)
    // Возврата не было (не переплатил) — счёт кассы не искали.
    assert.equal(calls.accountFindFirst, 0)
    // Заведена запись истории «за второй абонемент».
    assert.equal(calls.discountCreate.length, 1)
    assert.equal(calls.discountCreate[0].type, "second_subscription")
  })

  it("без флага: гейт activatedAt+1 держит текущий месяц — тип 1 НЕ применяется (долг остаётся, Пример 1-подобно)", async () => {
    const { tx, calls } = makeTx({ subs: subs() })
    await recalcClientDiscounts(tx as any, { tenantId: "t", clientId: "c1" })
    // Ни один абонемент текущего месяца не трогается: оба остаются source=none.
    assert.equal(calls.subUpdate.length, 0)
  })

  it("с флагом, но один абонемент в месяце: тип 1 требует >1 — скидка не подставляется (долг корректен, Пример 1)", async () => {
    const one = [subs()[1]] // только B
    const { tx, calls } = makeTx({ subs: one, paidBySub: { B: 4800 } })
    await recalcClientDiscounts(tx as any, {
      tenantId: "t",
      clientId: "c1",
      type1CoversCurrentMonth: true,
    })
    assert.equal(calls.subUpdate.length, 0)
  })

  it("без флага, но в месяце уже есть живой тип-1-абонемент (monthHasType1): инвариант держится — второй получает тип 1", async () => {
    // A уже несёт тип 1, B — без скидки. Триггер БЕЗ флага (напр. правка абонемента)
    // не должен «заморозить» инвариант: B тоже должен получить скидку.
    const s = subs()
    s[0].discountSource = "type1"
    s[0].discountPerLesson = 50
    s[0].chargedAmount = 3000
    const { tx, calls } = makeTx({ subs: s, paidBySub: { A: 4800, B: 4800 } })
    await recalcClientDiscounts(tx as any, { tenantId: "t", clientId: "c1" })
    // Освобождён самый дорогой (равенство → более ранний A уже type1 — но exempt
    // считается по totalAmount, A и B равны, exempt=A). B получает тип 1.
    const bUpd = calls.subUpdate.find((u) => u.id === "B")
    assert.ok(bUpd, "B должен получить тип 1 через monthHasType1")
    assert.equal(bUpd.data.discountSource, "type1")
  })
})
