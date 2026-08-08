import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { recomputeWardSalesStage } from "../lib/services/ward-sales-stage"

// Фейк транзакции: только методы, которые дёргает recomputeWardSalesStage.
function fakeTx(cfg: {
  apps: { stage: string }[]
  current: { salesStage: string; clientId: string } | null
  siblingAwaitingCount: number
}) {
  const calls = {
    wardUpdate: 0,
    taskUpdateMany: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  }
  const tx = {
    application: { findMany: async () => cfg.apps },
    ward: {
      findUnique: async () => cfg.current,
      update: async () => {
        calls.wardUpdate++
        return {}
      },
      count: async () => cfg.siblingAwaitingCount,
    },
    task: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.taskUpdateMany.push(args)
        return { count: 1 }
      },
    },
  }
  return { tx: tx as unknown as Parameters<typeof recomputeWardSalesStage>[0], calls }
}

const AT = new Date(Date.UTC(2026, 7, 8))

describe("recomputeWardSalesStage — автозакрытие payment_due при выходе из ожидания", () => {
  it("вышел из awaiting, у родителя нет других детей в ожидании → закрываем задачу", async () => {
    const { tx, calls } = fakeTx({
      apps: [],
      current: { salesStage: "awaiting_payment", clientId: "c1" },
      siblingAwaitingCount: 0,
    })
    const best = await recomputeWardSalesStage(tx, "t1", "w1", AT)
    assert.equal(best, "none")
    assert.equal(calls.taskUpdateMany.length, 1)
    const arg = calls.taskUpdateMany[0]
    assert.equal(arg.where.clientId, "c1")
    assert.equal(arg.where.autoTrigger, "payment_due")
    assert.equal(arg.where.status, "pending")
    assert.equal(arg.data.status, "completed")
  })

  it("вышел из awaiting, но есть ещё ребёнок в ожидании → НЕ закрываем", async () => {
    const { tx, calls } = fakeTx({
      apps: [],
      current: { salesStage: "awaiting_payment", clientId: "c1" },
      siblingAwaitingCount: 1,
    })
    await recomputeWardSalesStage(tx, "t1", "w1", AT)
    assert.equal(calls.taskUpdateMany.length, 0)
  })

  it("ребёнок был НЕ в ожидании (application → none) → закрытия нет", async () => {
    const { tx, calls } = fakeTx({
      apps: [],
      current: { salesStage: "application", clientId: "c1" },
      siblingAwaitingCount: 0,
    })
    await recomputeWardSalesStage(tx, "t1", "w1", AT)
    assert.equal(calls.taskUpdateMany.length, 0)
  })

  it("этап не изменился (awaiting → awaiting) → ни update, ни закрытия", async () => {
    const { tx, calls } = fakeTx({
      apps: [{ stage: "awaiting_payment" }],
      current: { salesStage: "awaiting_payment", clientId: "c1" },
      siblingAwaitingCount: 0,
    })
    await recomputeWardSalesStage(tx, "t1", "w1", AT)
    assert.equal(calls.wardUpdate, 0)
    assert.equal(calls.taskUpdateMany.length, 0)
  })
})
