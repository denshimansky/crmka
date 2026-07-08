/**
 * Unit-тесты для ensureEnrollmentForSubscription (общее зачисление при выписке:
 * POST /api/subscriptions, массовая/поштучная выписка, реанимация пакета) и
 * prevMonthOfRange (закрытые прошлого месяца как источники выписки).
 *
 * Чистая логика без БД: подменяем Tx моком и проверяем:
 *  - нет записи → create (awaiting_payment, isActive, enrolledAt = startDate);
 *  - живое зачисление → enrolledAt = min(existing, startDate), paymentStatus
 *    НЕ трогаем (иначе оплаченный месяц получит ложный бейдж «Ожидаем оплату»);
 *  - выбывшее: ПРОДОЛЖЕНИЕ (последний абонемент в группе closed + свежий
 *    withdrawnAt) → история сохраняется (enrolledAt = min); ВОЗВРАТ (последний
 *    withdrawn ИЛИ выбытие давнее) → реактивация от startDate, в занятиях гэпа
 *    ребёнок не участвует. paymentStatus='awaiting_payment' в обоих случаях.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ensureEnrollmentForSubscription } from "../lib/subscriptions/ensure-enrollment"
import { prevMonthOfRange } from "../lib/subscriptions/bulk-renew"

type AnyArgs = { where: Record<string, any>; data?: Record<string, any>; orderBy?: any }

interface EnrollmentRow {
  id: string
  isActive: boolean
  withdrawnAt: Date | null
  enrolledAt: Date | null
}

function makeTx(
  existing: EnrollmentRow | null,
  lastFinishedStatus: "closed" | "withdrawn" | null = null,
) {
  const calls = {
    findFirst: [] as AnyArgs[],
    subFindFirst: [] as AnyArgs[],
    update: [] as AnyArgs[],
    create: [] as AnyArgs[],
  }
  const tx = {
    groupEnrollment: {
      findFirst: async (args: AnyArgs) => {
        calls.findFirst.push(args)
        return existing
      },
      update: async (args: AnyArgs) => {
        calls.update.push(args)
        return existing
      },
      create: async (args: AnyArgs) => {
        calls.create.push(args)
        return { id: "new" }
      },
    },
    subscription: {
      findFirst: async (args: AnyArgs) => {
        calls.subFindFirst.push(args)
        return lastFinishedStatus ? { status: lastFinishedStatus } : null
      },
    },
  }
  return { tx: tx as any, calls }
}

const input = {
  tenantId: "t1",
  groupId: "g1",
  clientId: "c1",
  wardId: "w1",
  startDate: new Date("2026-07-01T00:00:00.000Z"),
}

describe("ensureEnrollmentForSubscription", () => {
  it("нет записи → create с awaiting_payment и enrolledAt = startDate", async () => {
    const { tx, calls } = makeTx(null)
    await ensureEnrollmentForSubscription(tx, input)
    assert.equal(calls.update.length, 0)
    assert.equal(calls.create.length, 1)
    const data = calls.create[0].data!
    assert.equal(data.paymentStatus, "awaiting_payment")
    assert.equal(data.isActive, true)
    assert.equal(data.wardId, "w1")
    assert.equal(data.enrolledAt.getTime(), input.startDate.getTime())
  })

  it("живое зачисление с более ранней датой → min(existing, startDate), paymentStatus не трогаем", async () => {
    const earlier = new Date("2026-06-15T00:00:00.000Z")
    const { tx, calls } = makeTx({ id: "e1", isActive: true, withdrawnAt: null, enrolledAt: earlier })
    await ensureEnrollmentForSubscription(tx, input)
    assert.equal(calls.create.length, 0)
    assert.equal(calls.update.length, 1)
    const data = calls.update[0].data!
    assert.equal(data.enrolledAt.getTime(), earlier.getTime())
    assert.equal(data.isActive, true)
    assert.equal(data.withdrawnAt, null)
    assert.ok(!("paymentStatus" in data), "живому зачислению paymentStatus менять нельзя")
    assert.equal(calls.subFindFirst.length, 0, "живое зачисление не требует запроса абонементов")
  })

  it("живое зачисление с более поздней датой → enrolledAt поддержан задним числом до startDate", async () => {
    const later = new Date("2026-07-15T00:00:00.000Z")
    const { tx, calls } = makeTx({ id: "e1", isActive: true, withdrawnAt: null, enrolledAt: later })
    await ensureEnrollmentForSubscription(tx, input)
    const data = calls.update[0].data!
    assert.equal(data.enrolledAt.getTime(), input.startDate.getTime())
  })

  it("ПРОДОЛЖЕНИЕ: закрыт кроном (withdrawnAt в прошлом месяце, последний абонемент closed) → история enrolledAt сохранена", async () => {
    const historic = new Date("2026-02-01T00:00:00.000Z")
    const { tx, calls } = makeTx(
      // Крон закрыл июнь: withdrawnAt = конец периода + 1 = 1 июля.
      { id: "e1", isActive: false, withdrawnAt: new Date("2026-07-01T00:00:00.000Z"), enrolledAt: historic },
      "closed",
    )
    await ensureEnrollmentForSubscription(tx, input)
    const data = calls.update[0].data!
    assert.equal(data.enrolledAt.getTime(), historic.getTime(), "история состава прошлых месяцев не должна теряться")
    assert.equal(data.isActive, true)
    assert.equal(data.withdrawnAt, null)
    assert.equal(data.paymentStatus, "awaiting_payment")
  })

  it("ВОЗВРАТ после отчисления (последний абонемент withdrawn) → реактивация от startDate", async () => {
    const old = new Date("2026-03-01T00:00:00.000Z")
    const { tx, calls } = makeTx(
      { id: "e1", isActive: false, withdrawnAt: new Date("2026-06-10T00:00:00.000Z"), enrolledAt: old },
      "withdrawn",
    )
    await ensureEnrollmentForSubscription(tx, input)
    const data = calls.update[0].data!
    assert.equal(data.enrolledAt.getTime(), input.startDate.getTime(), "в занятиях гэпа отчисленный не участвует")
    assert.equal(data.withdrawnAt, null)
    assert.equal(data.paymentStatus, "awaiting_payment")
  })

  it("ВОЗВРАТ после долгого гэпа (закрыт давно, withdrawnAt старее прошлого месяца) → реактивация от startDate", async () => {
    const old = new Date("2026-01-01T00:00:00.000Z")
    const { tx, calls } = makeTx(
      // Март закрыт, ребёнок вернулся в июле: continuation не признаём.
      { id: "e1", isActive: false, withdrawnAt: new Date("2026-04-01T00:00:00.000Z"), enrolledAt: old },
      "closed",
    )
    await ensureEnrollmentForSubscription(tx, input)
    const data = calls.update[0].data!
    assert.equal(data.enrolledAt.getTime(), input.startDate.getTime())
  })

  it("выбывшее без единого завершённого абонемента в группе → реактивация от startDate", async () => {
    const { tx, calls } = makeTx(
      { id: "e1", isActive: false, withdrawnAt: new Date("2026-06-20T00:00:00.000Z"), enrolledAt: new Date("2026-06-01T00:00:00.000Z") },
      null,
    )
    await ensureEnrollmentForSubscription(tx, input)
    const data = calls.update[0].data!
    assert.equal(data.enrolledAt.getTime(), input.startDate.getTime())
  })

  it("скоуп поиска: tenant + group + client + ward, только не удалённые", async () => {
    const { tx, calls } = makeTx(null)
    await ensureEnrollmentForSubscription(tx, { ...input, wardId: null })
    const where = calls.findFirst[0].where
    assert.equal(where.tenantId, "t1")
    assert.equal(where.groupId, "g1")
    assert.equal(where.clientId, "c1")
    assert.equal(where.wardId, null)
    assert.equal(where.deletedAt, null)
  })
})

describe("prevMonthOfRange", () => {
  it("июль → июнь того же года", () => {
    assert.deepEqual(prevMonthOfRange(new Date(2026, 6, 1)), { year: 2026, month: 6 })
  })
  it("январь → декабрь прошлого года", () => {
    assert.deepEqual(prevMonthOfRange(new Date(2026, 0, 1)), { year: 2025, month: 12 })
  })
})
