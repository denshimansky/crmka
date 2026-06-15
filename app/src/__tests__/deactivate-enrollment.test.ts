/**
 * Unit-тесты для deactivateGroupEnrollmentOnWithdrawal.
 *
 * Чистая логика без БД: подменяем Tx моком и проверяем правило
 * «убирать ребёнка из группы только если не осталось другого живого
 * (pending/active) абонемента в той же группе» + корректный scope по wardId.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { deactivateGroupEnrollmentOnWithdrawal } from "../lib/subscriptions/deactivate-enrollment"

type CountArgs = { where: Record<string, any> }
type UpdateArgs = { where: Record<string, any>; data: Record<string, any> }

function makeTx(opts: { otherLive: number; updatedCount?: number }) {
  const calls = { count: [] as CountArgs[], updateMany: [] as UpdateArgs[] }
  const tx = {
    subscription: {
      count: async (args: CountArgs) => {
        calls.count.push(args)
        return opts.otherLive
      },
    },
    groupEnrollment: {
      updateMany: async (args: UpdateArgs) => {
        calls.updateMany.push(args)
        return { count: opts.updatedCount ?? 1 }
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
    assert.equal(calls.updateMany.length, 0, "updateMany не должен вызываться")
    // guard считает только живые и исключает текущий абонемент
    assert.deepEqual(calls.count[0].where.status, { in: ["pending", "active"] })
    assert.deepEqual(calls.count[0].where.id, { not: "s1" })
    assert.equal(calls.count[0].where.deletedAt, null)
  })

  it("деактивирует зачисление, если живых абонементов не осталось", async () => {
    const { tx, calls } = makeTx({ otherLive: 0, updatedCount: 1 })
    const res = await deactivateGroupEnrollmentOnWithdrawal(tx as any, base)
    assert.equal(res, 1)
    assert.equal(calls.updateMany.length, 1)
    const { where, data } = calls.updateMany[0]
    assert.equal(where.clientId, "c")
    assert.equal(where.wardId, "w")
    assert.equal(where.isActive, true)
    assert.equal(where.deletedAt, null)
    assert.equal(data.isActive, false)
    assert.ok(data.withdrawnAt instanceof Date)
  })

  it("взрослый абонемент (wardId=null): scope по wardId IS NULL — и в guard, и в действии", async () => {
    const { tx, calls } = makeTx({ otherLive: 0 })
    await deactivateGroupEnrollmentOnWithdrawal(tx as any, { ...base, wardId: null })
    // null (а не undefined) — иначе Prisma сняла бы фильтр и задела детей клиента
    assert.equal(calls.count[0].where.wardId, null)
    assert.equal(calls.updateMany[0].where.wardId, null)
    assert.equal(calls.count[0].where.clientId, "c")
  })

  it("использует переданный withdrawnAt", async () => {
    const { tx, calls } = makeTx({ otherLive: 0 })
    const d = new Date("2026-06-01T00:00:00.000Z")
    await deactivateGroupEnrollmentOnWithdrawal(tx as any, { ...base, withdrawnAt: d })
    assert.equal(calls.updateMany[0].data.withdrawnAt, d)
  })
})
