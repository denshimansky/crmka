/**
 * Unit-тесты для deactivateGroupEnrollmentOnWithdrawal.
 *
 * Чистая логика без БД: подменяем Tx моком и проверяем:
 *  - правило «убирать ребёнка из группы только если не осталось другого живого
 *    (pending/active) абонемента в той же группе» + корректный scope по wardId;
 *  - граница состава (withdrawnAt) = последнее платное занятие в группе + 1, а
 *    при отсутствии платных занятий = enrolledAt (баг #40: отчисленный без
 *    платных занятий не должен висеть в «Неотмеченных»).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { deactivateGroupEnrollmentOnWithdrawal } from "../lib/subscriptions/deactivate-enrollment"

type AnyArgs = { where: Record<string, any>; data?: Record<string, any>; orderBy?: any; select?: any }

function makeTx(opts: {
  otherLive: number
  enrollments?: { id: string; enrolledAt: Date }[]
  lastPaidDate?: Date | null
}) {
  const calls = {
    count: [] as AnyArgs[],
    findMany: [] as AnyArgs[],
    attendanceFindFirst: [] as AnyArgs[],
    update: [] as AnyArgs[],
  }
  const enrollments = opts.enrollments ?? [
    { id: "e1", enrolledAt: new Date("2026-06-01T00:00:00.000Z") },
  ]
  const tx = {
    subscription: {
      count: async (args: AnyArgs) => {
        calls.count.push(args)
        return opts.otherLive
      },
    },
    attendance: {
      findFirst: async (args: AnyArgs) => {
        calls.attendanceFindFirst.push(args)
        return opts.lastPaidDate
          ? { lesson: { date: opts.lastPaidDate } }
          : null
      },
    },
    groupEnrollment: {
      findMany: async (args: AnyArgs) => {
        calls.findMany.push(args)
        return enrollments
      },
      update: async (args: AnyArgs) => {
        calls.update.push(args)
        return { id: (args.where as any).id }
      },
    },
  }
  return { tx, calls }
}

const base = {
  tenantId: "t",
  groupId: "g",
  clientId: "c",
  wardId: "w" as string | null,
  excludeSubscriptionId: "s1",
}

describe("deactivateGroupEnrollmentOnWithdrawal", () => {
  it("оставляет ребёнка в группе, если есть другой живой абонемент", async () => {
    const { tx, calls } = makeTx({ otherLive: 1 })
    const res = await deactivateGroupEnrollmentOnWithdrawal(tx as any, base)
    assert.equal(res, 0)
    assert.equal(calls.update.length, 0, "update не должен вызываться")
    assert.equal(calls.findMany.length, 0, "findMany не должен вызываться")
    // guard считает только живые и исключает текущий абонемент
    assert.deepEqual(calls.count[0].where.status, { in: ["pending", "active"] })
    assert.deepEqual(calls.count[0].where.id, { not: "s1" })
    assert.equal(calls.count[0].where.deletedAt, null)
  })

  it("граница = последнее платное занятие + 1", async () => {
    const { tx, calls } = makeTx({
      otherLive: 0,
      enrollments: [{ id: "e1", enrolledAt: new Date("2026-06-01T00:00:00.000Z") }],
      lastPaidDate: new Date("2026-06-13T00:00:00.000Z"),
    })
    const res = await deactivateGroupEnrollmentOnWithdrawal(tx as any, base)
    assert.equal(res, 1)
    assert.equal(calls.update.length, 1)
    const { where, data } = calls.update[0]
    assert.equal(where.id, "e1")
    assert.equal(data!.isActive, false)
    assert.equal(
      (data!.withdrawnAt as Date).getTime(),
      new Date("2026-06-14T00:00:00.000Z").getTime(),
      "withdrawnAt = последнее платное + 1",
    )
  })

  it("нет платных занятий → withdrawnAt = enrolledAt (невидим везде)", async () => {
    const enrolledAt = new Date("2026-06-10T00:00:00.000Z")
    const { tx, calls } = makeTx({
      otherLive: 0,
      enrollments: [{ id: "e1", enrolledAt }],
      lastPaidDate: null,
    })
    await deactivateGroupEnrollmentOnWithdrawal(tx as any, base)
    assert.equal(
      (calls.update[0].data!.withdrawnAt as Date).getTime(),
      enrolledAt.getTime(),
      "без платных занятий граница = enrolledAt",
    )
  })

  it("взрослый абонемент (wardId=null): scope по wardId IS NULL — в guard, findMany и attendance", async () => {
    const { tx, calls } = makeTx({ otherLive: 0, lastPaidDate: null })
    await deactivateGroupEnrollmentOnWithdrawal(tx as any, { ...base, wardId: null })
    // null (а не undefined) — иначе Prisma сняла бы фильтр и задела детей клиента
    assert.equal(calls.count[0].where.wardId, null)
    assert.equal(calls.findMany[0].where.wardId, null)
    assert.equal(calls.attendanceFindFirst[0].where.wardId, null)
    assert.equal(calls.count[0].where.clientId, "c")
  })

  it("последнее платное ищется только со списанием (charge_amount > 0) и в этой группе", async () => {
    const { tx, calls } = makeTx({ otherLive: 0, lastPaidDate: new Date("2026-06-13T00:00:00.000Z") })
    await deactivateGroupEnrollmentOnWithdrawal(tx as any, base)
    const w = calls.attendanceFindFirst[0].where
    assert.deepEqual(w.chargeAmount, { gt: 0 })
    assert.deepEqual(w.lesson, { groupId: "g" })
  })

  it("отложенное отчисление: withdrawnAt = scheduledBoundary (X+1), последнее платное НЕ учитывается", async () => {
    const scheduledBoundary = new Date("2026-07-01T00:00:00.000Z") // X=30.06 → X+1
    const { tx, calls } = makeTx({
      otherLive: 0,
      enrollments: [{ id: "e1", enrolledAt: new Date("2026-06-01T00:00:00.000Z") }],
      // last paid — в прошлом (13.06); при выводе по нему ребёнок выпал бы из
      // занятий 14–30.06 сразу. Отложенное отчисление обязано это игнорировать.
      lastPaidDate: new Date("2026-06-13T00:00:00.000Z"),
    })
    const res = await deactivateGroupEnrollmentOnWithdrawal(tx as any, { ...base, scheduledBoundary })
    assert.equal(res, 1)
    assert.equal(
      (calls.update[0].data!.withdrawnAt as Date).getTime(),
      scheduledBoundary.getTime(),
      "граница = X+1, а не последнее платное + 1",
    )
    assert.equal(
      calls.attendanceFindFirst.length,
      0,
      "запрос последнего платного при явной границе не нужен",
    )
  })
})
