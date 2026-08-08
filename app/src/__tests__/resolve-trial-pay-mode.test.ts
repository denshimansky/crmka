import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { resolveTrialPayMode } from "../lib/salary/resolve-rate"

// Мини-фейк Prisma: только методы, которые дёргает resolveTrialPayMode.
// group === undefined → ставки группы нет (findUnique вернёт null).
type FakeConfig = {
  group?: { trialPayMode: string | null } | null
  exception?: { trialPayMode: string; schedules?: unknown[] } | null // личная по направлению
  default?: { trialPayMode: string; schedules?: unknown[] } | null // личная дефолтная
}

function fakeDb(cfg: FakeConfig) {
  const calls = { groupFindUnique: 0, salaryFindFirst: 0 }
  const db = {
    groupSalaryRate: {
      findUnique: async () => {
        calls.groupFindUnique++
        return cfg.group ?? null
      },
    },
    salaryRate: {
      findFirst: async (args: { where: { directionId: string | null } }) => {
        calls.salaryFindFirst++
        const row = args.where.directionId != null ? cfg.exception : cfg.default
        return row ? { trialPayMode: row.trialPayMode, schedules: row.schedules ?? [] } : null
      },
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, calls }
}

const AT = new Date(Date.UTC(2026, 6, 15)) // 2026-07-15

describe("resolveTrialPayMode — приоритет группы и наследование", () => {
  it("ставка группы с явным режимом перекрывает личную (до личной не доходим)", async () => {
    const { db, calls } = fakeDb({ group: { trialPayMode: "all" }, default: { trialPayMode: "none" } })
    const r = await resolveTrialPayMode(db, { tenantId: "t", groupId: "g", employeeId: "e", directionId: null }, AT)
    assert.equal(r, "all")
    assert.equal(calls.salaryFindFirst, 0)
  })

  it("ставка группы с trialPayMode=null → наследуем личную", async () => {
    const { db } = fakeDb({ group: { trialPayMode: null }, default: { trialPayMode: "paid_only" } })
    const r = await resolveTrialPayMode(db, { tenantId: "t", groupId: "g", employeeId: "e", directionId: null }, AT)
    assert.equal(r, "paid_only")
  })

  it("ставки группы нет → личная дефолтная", async () => {
    const { db } = fakeDb({ group: null, default: { trialPayMode: "all" } })
    const r = await resolveTrialPayMode(db, { tenantId: "t", groupId: "g", employeeId: "e", directionId: null }, AT)
    assert.equal(r, "all")
  })

  it("groupId не передан → ставку группы не запрашиваем", async () => {
    const { db, calls } = fakeDb({ default: { trialPayMode: "none" } })
    const r = await resolveTrialPayMode(db, { tenantId: "t", employeeId: "e", directionId: null }, AT)
    assert.equal(r, "none")
    assert.equal(calls.groupFindUnique, 0)
  })

  it("личная: исключение по направлению побеждает дефолт", async () => {
    const { db } = fakeDb({ group: null, exception: { trialPayMode: "all" }, default: { trialPayMode: "none" } })
    const r = await resolveTrialPayMode(db, { tenantId: "t", groupId: "g", employeeId: "e", directionId: "d1" }, AT)
    assert.equal(r, "all")
  })

  it("нет ни группы, ни личных ставок → none", async () => {
    const { db } = fakeDb({ group: null })
    const r = await resolveTrialPayMode(db, { tenantId: "t", groupId: "g", employeeId: "e", directionId: "d1" }, AT)
    assert.equal(r, "none")
  })

  it("версия личной ставки на дату побеждает базовую (pickRateAt)", async () => {
    const { db } = fakeDb({
      group: null,
      default: {
        trialPayMode: "none", // база (с начала)
        schedules: [{ trialPayMode: "all", effectiveFrom: new Date(Date.UTC(2026, 6, 1)), deletedAt: null }],
      },
    })
    const r = await resolveTrialPayMode(db, { tenantId: "t", groupId: "g", employeeId: "e", directionId: null }, AT)
    assert.equal(r, "all") // на 15.07 действует версия с 01.07
  })
})
