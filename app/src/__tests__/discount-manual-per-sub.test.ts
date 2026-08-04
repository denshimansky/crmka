/**
 * Скидки v3 — ручная (пер-абонементная) скидка исключается из тип-1 «за второй и
 * следующие». recalcClientDiscounts ведёт ТОЛЬКО тип 1 и только среди абонементов
 * БЕЗ выбранного шаблона (discountTemplateId=null и source != type2/legacy).
 *
 * Мок-Tx по образцу discount-switch-current-month.test.ts (тип-1 ветка recalc).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { recalcClientDiscounts } from "../lib/discounts/recalc-client-discounts"

const NOW = new Date()
const PY = NOW.getFullYear()
const PM = NOW.getMonth() + 1
const activatedThisMonth = new Date(PY, NOW.getMonth(), 1)

function sub(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
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
    discountTemplateId: null as string | null,
    // Порядок создания A < B < C (секунды по коду символа) — для тай-брейка exempt.
    createdAt: new Date(2026, 6, 7, 10, 0, id.charCodeAt(0)),
    ...over,
  }
}

function makeTx(subs: unknown[], attended: Record<string, number> = {}) {
  const calls = { subUpdate: [] as any[], discountCreate: [] as any[] }
  const tx: any = {
    client: {
      findFirst: async () => ({ id: "c1", autoDiscountDisabled: false }),
      findUnique: async () => ({ clientBalance: 0 }),
    },
    discountTemplate: {
      findFirst: async () => ({
        id: "t1",
        name: "Скидка за второй и следующие",
        valueType: "fixed",
        value: 50,
        isActive: true,
        activatedAt: activatedThisMonth,
      }),
    },
    subscription: {
      findMany: async () => subs,
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
    payment: { aggregate: async () => ({ _sum: { amount: 0 } }) },
    discount: {
      updateMany: async () => ({ count: 0 }),
      create: async (a: any) => {
        calls.discountCreate.push(a.data)
        return {}
      },
    },
    financialAccount: { findFirst: async () => ({ id: "acc1" }) },
  }
  return { tx, calls }
}

describe("Скидки v3 — ручная скидка исключается из тип-1 «за второй и следующие»", () => {
  it("A с ручной скидкой + B без: B единственный кандидат → тип 1 не применяется", async () => {
    const subs = [
      sub("A", { discountSource: "type2", discountPerLesson: 130, discountTemplateId: "tplX" }),
      sub("B"),
    ]
    const { tx, calls } = makeTx(subs)
    await recalcClientDiscounts(tx as any, {
      tenantId: "t",
      clientId: "c1",
      type1CoversCurrentMonth: true,
    })
    // Ручной A не трогаем; кандидатов тип-1 остаётся один (B) → скидка не выдаётся.
    assert.equal(calls.subUpdate.length, 0)
  })

  it("A(ручная) + B + C: тип 1 среди B,C (кроме самого дорогого), A не тронут", async () => {
    const subs = [
      sub("A", { discountSource: "type2", discountPerLesson: 130, discountTemplateId: "tplX" }),
      sub("B"),
      sub("C"),
    ]
    const { tx, calls } = makeTx(subs)
    await recalcClientDiscounts(tx as any, {
      tenantId: "t",
      clientId: "c1",
      type1CoversCurrentMonth: true,
    })
    const ids = calls.subUpdate.map((u) => u.id)
    // Ручной A вне тип-1 — не трогаем.
    assert.ok(!ids.includes("A"), "ручной A не трогаем")
    // Кандидаты {B,C} равны по цене → exempt = более ранний B; тип 1 получает C.
    const cUpd = calls.subUpdate.find((u) => u.id === "C")
    assert.ok(cUpd, "C получает тип 1")
    assert.equal(cUpd.data.discountSource, "type1")
    assert.ok(!ids.includes("B"), "B — самый дорогой из кандидатов, без скидки")
  })
})
