import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isGroupRateLocked } from "../lib/salary/group-rate-lock"

// Фейк Prisma: перехватывает where, переданный в lesson.findFirst, и возвращает
// заранее заданный «нашлось / не нашлось».
function fakeDb(found: boolean) {
  let capturedWhere: Record<string, unknown> | null = null
  const db = {
    lesson: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        capturedWhere = args.where
        return found ? { id: "l1" } : null
      },
    },
  }
  return { db: db as unknown as Parameters<typeof isGroupRateLocked>[0], getWhere: () => capturedWhere }
}

describe("isGroupRateLocked", () => {
  it("есть реальная отметка → заблокировано", async () => {
    const { db } = fakeDb(true)
    assert.equal(await isGroupRateLocked(db, "t1", "g1"), true)
  })

  it("нет отметок → не заблокировано", async () => {
    const { db } = fakeDb(false)
    assert.equal(await isGroupRateLocked(db, "t1", "g1"), false)
  })

  it("запрос фильтрует по группе, тенанту и ТОЛЬКО непендинговым отметкам", async () => {
    const { db, getWhere } = fakeDb(false)
    await isGroupRateLocked(db, "t1", "g1")
    const where = getWhere()!
    assert.equal(where.tenantId, "t1")
    assert.equal(where.groupId, "g1")
    // Плейсхолдеры (isPending=true) не должны запирать ставку.
    assert.deepEqual(where.attendances, { some: { isPending: false } })
  })
})
