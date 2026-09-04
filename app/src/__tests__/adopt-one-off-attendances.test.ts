/**
 * Unit-тесты подхвата разовых посещений абонементом, выписанным задним числом
 * (04.09.2026, кейс Вершининой: «Отработано 0/2» + разовые списания с баланса,
 * которые после переотметки превратились в двойную оплату).
 *
 * Проверяем:
 *   - coverageEnd: конец покрытия у календарного берётся из периода (end_date
 *     обычно пуст), у пакета — из expiresAt;
 *   - revertOneOffChargeForAttendance: возврат = списано − уже возвращённое,
 *     идемпотентность, «нет проводок» (импорт) → ничего не возвращаем;
 *   - adoptOneOffAttendances: подхват с возвратом разового и списанием с
 *     абонемента, ограничение свободными слотами, no-op без границы покрытия.
 *
 * Чистая логика на мок-Tx (как close-subscription.test.ts). repriceSubscription
 * короткозамыкаем: второй вызов subscription.findFirst отдаёт legacy-абонемент,
 * на котором пересчёт выходит сразу.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { Prisma } from "@prisma/client"
import {
  adoptOneOffAttendances,
  coverageEnd,
} from "../lib/subscriptions/adopt-one-off-attendances"
import { revertOneOffChargeForAttendance } from "../lib/balance/revert-one-off-charge"

const D = (v: number | string) => new Prisma.Decimal(v)
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

describe("coverageEnd", () => {
  it("календарный без end_date — последний день месяца периода", () => {
    const end = coverageEnd({
      endDate: null,
      periodYear: 2026,
      periodMonth: 8,
      expiresAt: null,
    })
    assert.equal(end?.toISOString().slice(0, 10), "2026-08-31")
  })

  it("февраль високосного года считается верно", () => {
    const end = coverageEnd({ endDate: null, periodYear: 2028, periodMonth: 2, expiresAt: null })
    assert.equal(end?.toISOString().slice(0, 10), "2028-02-29")
  })

  it("явный end_date выигрывает у периода", () => {
    const end = coverageEnd({
      endDate: day(2026, 8, 20),
      periodYear: 2026,
      periodMonth: 8,
      expiresAt: null,
    })
    assert.equal(end?.toISOString().slice(0, 10), "2026-08-20")
  })

  it("пакет — по expiresAt; без границ — null", () => {
    assert.equal(
      coverageEnd({ endDate: null, periodYear: null, periodMonth: null, expiresAt: day(2026, 9, 30) })
        ?.toISOString()
        .slice(0, 10),
      "2026-09-30",
    )
    assert.equal(
      coverageEnd({ endDate: null, periodYear: null, periodMonth: null, expiresAt: null }),
      null,
    )
  })
})

function ledgerTx(charged: number, reverted: number) {
  const created: any[] = []
  return {
    created,
    tx: {
      clientBalanceTransaction: {
        aggregate: async ({ where }: any) =>
          where.type === "attendance_revert"
            ? { _sum: { amount: D(reverted) } }
            : { _sum: { amount: D(-charged) } },
        create: async (args: any) => {
          created.push(args)
          return { id: "bt" }
        },
      },
      client: {
        update: async () => ({ clientBalance: D(0) }),
      },
    } as any,
  }
}

describe("revertOneOffChargeForAttendance", () => {
  const base = {
    tenantId: "t",
    clientId: "c1",
    attendanceId: "a1",
    lessonId: "l1",
    directionId: "d1",
    createdBy: null,
  }

  it("списано 1000, возвратов не было → возвращаем 1000", async () => {
    const { tx, created } = ledgerTx(1000, 0)
    const got = await revertOneOffChargeForAttendance(tx, base)
    assert.equal(got.toFixed(2), "1000.00")
    assert.equal(created.length, 1)
    assert.equal(created[0].data.type, "attendance_revert")
    assert.equal(created[0].data.attendanceId, "a1")
    // Возврат разового не привязан к абонементу — по этому признаку он и
    // отличается от отката частичного lesson_refund (см. lib/one-off-debt.ts).
    assert.equal(created[0].data.subscriptionId, null)
  })

  it("уже возвращено полностью → 0 и никаких проводок (идемпотентность)", async () => {
    const { tx, created } = ledgerTx(1000, 1000)
    const got = await revertOneOffChargeForAttendance(tx, base)
    assert.equal(got.toFixed(2), "0.00")
    assert.equal(created.length, 0)
  })

  it("возвращена часть → добираем остаток", async () => {
    const { tx, created } = ledgerTx(1000, 400)
    const got = await revertOneOffChargeForAttendance(tx, base)
    assert.equal(got.toFixed(2), "600.00")
    assert.equal(created.length, 1)
  })

  it("проводок нет (импортированная отметка) → денег не рисуем", async () => {
    const { tx, created } = ledgerTx(0, 0)
    const got = await revertOneOffChargeForAttendance(tx, base)
    assert.equal(got.toFixed(2), "0.00")
    assert.equal(created.length, 0)
  })
})

interface AdoptOpts {
  /** Разовые отметки-кандидаты (по возрастанию даты). */
  candidates?: { id: string; date: Date }[]
  /** Уже израсходовано занятий абонемента. */
  consumed?: number
  totalLessons?: number
  periodMonth?: number | null
  expiresAt?: Date | null
  /** Сколько разового списания висит по каждой отметке. */
  oneOffPerAttendance?: number
}

function makeAdoptTx(opts: AdoptOpts) {
  const calls = {
    attendanceUpdate: [] as any[],
    subUpdate: [] as any[],
    balanceCreate: [] as any[],
    audit: [] as any[],
    subFindFirst: 0,
  }
  const candidates = opts.candidates ?? []
  const oneOff = opts.oneOffPerAttendance ?? 1000

  const tx = {
    subscription: {
      findFirst: async () => {
        calls.subFindFirst++
        // Первый вызов — сам adopt. Второй — repriceSubscription, ему отдаём
        // legacy: пересчёт выходит сразу, мок остаётся компактным.
        if (calls.subFindFirst > 1) return { id: "s1", discountSource: "legacy", status: "active" }
        return {
          id: "s1",
          clientId: "c1",
          wardId: "w1",
          groupId: "g1",
          type: "calendar",
          totalLessons: opts.totalLessons ?? 2,
          lessonPrice: D(1000),
          discountPerLesson: D(0),
          startDate: day(2026, 8, 1),
          endDate: null,
          periodYear: 2026,
          periodMonth: opts.periodMonth === undefined ? 8 : opts.periodMonth,
          expiresAt: opts.expiresAt ?? null,
        }
      },
      update: async (args: any) => {
        calls.subUpdate.push(args)
        return { id: "s1" }
      },
    },
    attendance: {
      findMany: async () =>
        candidates.map((c) => ({
          id: c.id,
          lessonId: `l-${c.id}`,
          chargeAmount: D(oneOff),
          lesson: { date: c.date, groupId: "g1", group: { directionId: "d1" } },
        })),
      count: async () => opts.consumed ?? 0,
      update: async (args: any) => {
        calls.attendanceUpdate.push(args)
        return { id: args.where.id }
      },
    },
    clientBalanceTransaction: {
      aggregate: async ({ where }: any) =>
        where.type === "attendance_revert"
          ? { _sum: { amount: D(0) } }
          : { _sum: { amount: D(-oneOff) } },
      create: async (args: any) => {
        calls.balanceCreate.push(args)
        return { id: "bt" }
      },
    },
    client: { update: async () => ({ clientBalance: D(0) }) },
    auditLog: {
      create: async (args: any) => {
        calls.audit.push(args)
        return { id: "al" }
      },
    },
  } as any

  return { tx, calls }
}

describe("adoptOneOffAttendances", () => {
  const input = { tenantId: "t", subscriptionId: "s1", createdBy: null }

  it("две разовые отметки в периоде → подхвачены, разовое возвращено, абонемент списан", async () => {
    const { tx, calls } = makeAdoptTx({
      candidates: [
        { id: "a1", date: day(2026, 8, 20) },
        { id: "a2", date: day(2026, 8, 27) },
      ],
    })
    const adopted = await adoptOneOffAttendances(tx, input)

    assert.equal(adopted.length, 2)
    assert.equal(adopted[0].refunded.toFixed(2), "1000.00")
    assert.equal(adopted[0].charged.toFixed(2), "1000.00")
    // Обе отметки перецеплены на абонемент со списанием по цене занятия.
    assert.equal(calls.attendanceUpdate.length, 2)
    assert.equal(calls.attendanceUpdate[0].data.subscriptionId, "s1")
    assert.equal(calls.attendanceUpdate[0].data.chargeAmount.toFixed(2), "1000.00")
    // Возврат разового на баланс — по одной проводке на отметку.
    assert.equal(calls.balanceCreate.length, 2)
    assert.equal(calls.balanceCreate[0].data.type, "attendance_revert")
    // chargedAmount абонемента вырос дважды, пересчёт вызван.
    assert.equal(calls.subUpdate.length, 2)
    assert.equal(calls.subFindFirst, 2)
    assert.equal(calls.audit.length, 1)
  })

  it("свободен один слот → берём самую раннюю отметку, вторую не трогаем", async () => {
    const { tx, calls } = makeAdoptTx({
      candidates: [
        { id: "a1", date: day(2026, 8, 20) },
        { id: "a2", date: day(2026, 8, 27) },
      ],
      totalLessons: 2,
      consumed: 1,
    })
    const adopted = await adoptOneOffAttendances(tx, input)

    assert.equal(adopted.length, 1)
    assert.equal(adopted[0].attendanceId, "a1")
    assert.equal(calls.attendanceUpdate.length, 1)
  })

  it("слотов не осталось → no-op", async () => {
    const { tx, calls } = makeAdoptTx({
      candidates: [{ id: "a1", date: day(2026, 8, 20) }],
      totalLessons: 2,
      consumed: 2,
    })
    assert.deepEqual(await adoptOneOffAttendances(tx, input), [])
    assert.equal(calls.attendanceUpdate.length, 0)
    assert.equal(calls.balanceCreate.length, 0)
  })

  it("нет верхней границы покрытия (пакет без срока) → не гадаем, no-op", async () => {
    const { tx, calls } = makeAdoptTx({
      candidates: [{ id: "a1", date: day(2026, 8, 20) }],
      periodMonth: null,
      expiresAt: null,
    })
    assert.deepEqual(await adoptOneOffAttendances(tx, input), [])
    assert.equal(calls.attendanceUpdate.length, 0)
  })

  it("кандидатов нет → пересчёт не дёргаем", async () => {
    const { tx, calls } = makeAdoptTx({ candidates: [] })
    assert.deepEqual(await adoptOneOffAttendances(tx, input), [])
    assert.equal(calls.subFindFirst, 1)
    assert.equal(calls.audit.length, 0)
  })
})
