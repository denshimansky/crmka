/**
 * Скидки v3 (docs/discounts-v3.md §4, §6) — пер-абонементные скидки, ядро.
 *
 * 1. recalcClientDiscounts для клиента в режиме perSubDiscountMode — NO-OP:
 *    ни тип 1 «за второй», ни клиентский тип 2 не применяются (эксклюзивность
 *    режима), даже когда в месяце два абонемента и тип 1 включён.
 * 2. setSubscriptionManualDiscount — ставит пер-абонементный шаблон (scope=
 *    subscription, тип 2) на один абонемент: discountSource=type2, скидка в цене
 *    занятия, фиксирует discountTemplateId, заводит запись истории.
 * 3. …снимает скидку при templateId=null.
 *
 * Мок-Tx по образцу discount-switch-current-month.test.ts.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  recalcClientDiscounts,
  setSubscriptionManualDiscount,
} from "../lib/discounts/recalc-client-discounts"

const dec = (x: unknown) => Number(String(x))

const NOW = new Date()
const PY = NOW.getFullYear()
const PM = NOW.getMonth() + 1
const activatedThisMonth = new Date(PY, NOW.getMonth(), 1)

// Два равных календарных абонемента текущего месяца — состав, при котором тип 1
// (включён) применился бы к более дешёвому. В режиме perSubDiscountMode — не должен.
function twoEqualSubs() {
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
      chargedAmount: 0,
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
      chargedAmount: 0,
      discountPerLesson: 0,
      discountSource: "none",
      createdAt: new Date(2026, 6, 7, 10, 38, 37),
    },
  ]
}

function makeRecalcTx(opts: { perSubDiscountMode: boolean; subs: any[] }) {
  const calls = { subUpdate: [] as any[], subFindMany: 0 }
  const tx: any = {
    client: {
      findFirst: async () => ({
        id: "c1",
        discountTemplateId: null,
        autoDiscountDisabled: false,
        perSubDiscountMode: opts.perSubDiscountMode,
      }),
      findUnique: async () => ({ clientBalance: 0 }),
    },
    discountTemplate: {
      findFirst: async () => ({
        id: "t1",
        name: "Скидка за второй абонемент",
        valueType: "fixed",
        value: 50,
        isActive: true,
        activatedAt: activatedThisMonth,
      }),
    },
    subscription: {
      findMany: async () => {
        calls.subFindMany++
        return opts.subs
      },
      update: async (args: any) => {
        calls.subUpdate.push({ id: args.where.id, data: args.data })
        return {}
      },
    },
    attendance: {
      groupBy: async () => [],
      count: async () => 0,
    },
    payment: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    discount: {
      updateMany: async () => ({ count: 0 }),
      create: async () => ({}),
    },
    financialAccount: { findFirst: async () => ({ id: "acc1" }) },
  }
  return { tx, calls }
}

describe("recalcClientDiscounts — режим perSubDiscountMode", () => {
  it("NO-OP: клиент в режиме «на абонемент» не получает ни тип 1, ни тип 2", async () => {
    const { tx, calls } = makeRecalcTx({ perSubDiscountMode: true, subs: twoEqualSubs() })
    await recalcClientDiscounts(tx as any, { tenantId: "t", clientId: "c1" })
    // Ранний выход: абонементы даже не загружаются, ничего не обновляется.
    assert.equal(calls.subUpdate.length, 0)
    assert.equal(calls.subFindMany, 0)
  })

  it("контроль: тот же состав у ОБЫЧНОГО клиента — тип 1 применяется (B получает скидку)", async () => {
    const { tx, calls } = makeRecalcTx({ perSubDiscountMode: false, subs: twoEqualSubs() })
    await recalcClientDiscounts(tx as any, {
      tenantId: "t",
      clientId: "c1",
      type1CoversCurrentMonth: true,
    })
    const bUpd = calls.subUpdate.find((u) => u.id === "B")
    assert.ok(bUpd, "у обычного клиента тип 1 должен примениться к B")
    assert.equal(bUpd.data.discountSource, "type1")
  })
})

// ─── setSubscriptionManualDiscount ───

function makeManualTx(sub: any) {
  const calls = { subUpdate: [] as any[], discountCreate: [] as any[], discountUpdateMany: 0 }
  const tx: any = {
    subscription: {
      findFirst: async () => sub,
      update: async (args: any) => {
        calls.subUpdate.push({ id: args.where.id, data: args.data })
        return {}
      },
    },
    discountTemplate: {
      findFirst: async (args: any) => {
        if (args.where.id === "tplPct") {
          return { id: "tplPct", name: "Скидка на абонемент", valueType: "percent", value: 10 }
        }
        return null
      },
    },
    attendance: { count: async () => 0 },
    payment: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    discount: {
      updateMany: async () => {
        calls.discountUpdateMany++
        return { count: 0 }
      },
      create: async (args: any) => {
        calls.discountCreate.push(args.data)
        return {}
      },
    },
    financialAccount: { findFirst: async () => ({ id: "acc1" }) },
    client: { findUnique: async () => ({ clientBalance: 0 }) },
  }
  return { tx, calls }
}

function baseSub(over: Record<string, unknown> = {}) {
  return {
    id: "S",
    clientId: "c1",
    wardId: "w1",
    groupId: "g1",
    directionId: "d1",
    type: "calendar",
    status: "pending",
    lessonPrice: 1000,
    totalLessons: 8,
    totalAmount: 8000,
    chargedAmount: 0,
    discountPerLesson: 0,
    discountSource: "none",
    discountTemplateId: null,
    ...over,
  }
}

describe("setSubscriptionManualDiscount", () => {
  it("ставит пер-абонементный шаблон (10%): source=type2, скидка в цене, фиксирует шаблон, пишет историю", async () => {
    const { tx, calls } = makeManualTx(baseSub())
    await setSubscriptionManualDiscount(tx as any, {
      tenantId: "t",
      subscriptionId: "S",
      templateId: "tplPct",
    })

    // Одно обновление денег (recomputeMoney) + одно — discountTemplateId.
    const money = calls.subUpdate.find((u) => "discountSource" in u.data)
    const tplUpd = calls.subUpdate.find((u) => "discountTemplateId" in u.data)
    assert.ok(money, "деньги должны пересчитаться (есть остаток)")
    assert.equal(money.data.discountSource, "type2")
    assert.equal(dec(money.data.discountPerLesson), 100) // 10% от 1000
    // final = 0 снимок + 8 × 900 = 7200; discountAmount = 8000 − 7200 = 800.
    assert.equal(dec(money.data.finalAmount), 7200)
    assert.equal(dec(money.data.discountAmount), 800)
    assert.ok(tplUpd, "discountTemplateId должен зафиксироваться")
    assert.equal(tplUpd.data.discountTemplateId, "tplPct")
    // История: закрыли активные permanent + создали новую.
    assert.equal(calls.discountUpdateMany, 1)
    assert.equal(calls.discountCreate.length, 1)
    assert.equal(calls.discountCreate[0].type, "permanent")
  })

  it("снимает скидку при templateId=null: source=none, скидка 0, шаблон сброшен", async () => {
    const withDiscount = baseSub({
      discountPerLesson: 100,
      discountSource: "type2",
      discountTemplateId: "tplPct",
    })
    const { tx, calls } = makeManualTx(withDiscount)
    await setSubscriptionManualDiscount(tx as any, {
      tenantId: "t",
      subscriptionId: "S",
      templateId: null,
    })

    const money = calls.subUpdate.find((u) => "discountSource" in u.data)
    const tplUpd = calls.subUpdate.find((u) => "discountTemplateId" in u.data)
    assert.ok(money, "деньги должны пересчитаться на полную цену")
    assert.equal(money.data.discountSource, "none")
    assert.equal(dec(money.data.discountPerLesson), 0)
    assert.equal(dec(money.data.finalAmount), 8000)
    assert.equal(tplUpd.data.discountTemplateId, null)
    // История закрыта, новой записи нет (скидку сняли).
    assert.equal(calls.discountUpdateMany, 1)
    assert.equal(calls.discountCreate.length, 0)
  })
})
