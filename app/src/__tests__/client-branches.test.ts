/**
 * Баг #79: два последних РАЗНЫХ филиала абонементов клиента.
 * Чистая логика без БД: инкрементальный сдвиг (при выписке) и пакетный расчёт
 * (из истории) должны давать одно и то же.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  shiftClientBranches,
  twoRecentDistinctBranches,
} from "../lib/subscriptions/client-branches"

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc"

describe("shiftClientBranches (инкрементальный сдвиг при выписке)", () => {
  it("первый абонемент → last = новый, prev = null", () => {
    assert.deepEqual(
      shiftClientBranches({ lastBranchId: null, prevBranchId: null }, A),
      { lastBranchId: A, prevBranchId: null },
    )
  })

  it("новый филиал ≠ last → сдвиг (prev := старый last)", () => {
    assert.deepEqual(
      shiftClientBranches({ lastBranchId: A, prevBranchId: null }, B),
      { lastBranchId: B, prevBranchId: A },
    )
  })

  it("тот же филиал, что last → без изменений", () => {
    assert.deepEqual(
      shiftClientBranches({ lastBranchId: B, prevBranchId: A }, B),
      { lastBranchId: B, prevBranchId: A },
    )
  })

  it("третий разный филиал вытесняет самый старый", () => {
    assert.deepEqual(
      shiftClientBranches({ lastBranchId: B, prevBranchId: A }, C),
      { lastBranchId: C, prevBranchId: B },
    )
  })

  it("возврат в прежний филиал 1→2→1 → last=1, prev=2", () => {
    let s = shiftClientBranches({ lastBranchId: null, prevBranchId: null }, A)
    s = shiftClientBranches(s, B)
    s = shiftClientBranches(s, A)
    assert.deepEqual(s, { lastBranchId: A, prevBranchId: B })
  })
})

describe("twoRecentDistinctBranches (пакетный расчёт из истории)", () => {
  it("история 1,2,3 (newest-first 3,2,1) → last=3, prev=2", () => {
    assert.deepEqual(twoRecentDistinctBranches([C, B, A]), {
      lastBranchId: C,
      prevBranchId: B,
    })
  })

  it("история 1,2,2 (newest-first 2,2,1) → last=2, prev=1 (два РАЗНЫХ)", () => {
    assert.deepEqual(twoRecentDistinctBranches([B, B, A]), {
      lastBranchId: B,
      prevBranchId: A,
    })
  })

  it("один филиал → prev = null", () => {
    assert.deepEqual(twoRecentDistinctBranches([A, A, A]), {
      lastBranchId: A,
      prevBranchId: null,
    })
  })

  it("пустая история → оба null", () => {
    assert.deepEqual(twoRecentDistinctBranches([]), {
      lastBranchId: null,
      prevBranchId: null,
    })
  })

  it("null-филиалы пропускаются", () => {
    assert.deepEqual(twoRecentDistinctBranches([null, B, null, A]), {
      lastBranchId: B,
      prevBranchId: A,
    })
  })
})

describe("эквивалентность инкрементального и пакетного расчёта", () => {
  // twoRecentDistinctBranches(история newest-first) === повторный
  // shiftClientBranches(история oldest→newest).
  const histories: string[][] = [
    [A, B, C],
    [A, B, B],
    [A, B, A],
    [A, A, A],
    [C, A, B, A, C],
    [A],
  ]
  for (const hist of histories) {
    it(`история ${hist.join("→")}`, () => {
      let s: { lastBranchId: string | null; prevBranchId: string | null } = {
        lastBranchId: null,
        prevBranchId: null,
      }
      for (const b of hist) s = shiftClientBranches(s, b)
      const batch = twoRecentDistinctBranches([...hist].reverse())
      assert.deepEqual(s, batch)
    })
  }
})
