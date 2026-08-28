/**
 * Unit-тесты для groupBranchWhere — ADM-04-скоуп массовой/точечной выписки
 * абонементов (bulk-renew).
 *
 * Правило: администратор, привязанный к филиалам, выписывает абонементы ТОЛЬКО
 * по своим филиалам. Владелец/управляющий (allowedBranchIds = null) — без
 * ограничений. Чистая логика без БД: проверяем WHERE-фрагмент по группе.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { groupBranchWhere } from "../lib/subscriptions/bulk-renew"

const BR_A = "11111111-1111-1111-1111-111111111111"
const BR_B = "22222222-2222-2222-2222-222222222222"
const BR_C = "33333333-3333-3333-3333-333333333333"

describe("groupBranchWhere", () => {
  it("владелец без фильтра → null (не ограничиваем where.group)", () => {
    assert.equal(groupBranchWhere({}), null)
    assert.equal(groupBranchWhere({ branchId: null, allowedBranchIds: null }), null)
  })

  it("владелец с фильтром «Филиал» → ровно этот филиал", () => {
    assert.deepEqual(groupBranchWhere({ branchId: BR_A, allowedBranchIds: null }), {
      branchId: BR_A,
    })
  })

  it("админ без фильтра → только его филиалы", () => {
    assert.deepEqual(groupBranchWhere({ allowedBranchIds: [BR_A, BR_B] }), {
      branchId: { in: [BR_A, BR_B] },
    })
  })

  it("админ выбрал СВОЙ филиал → пересечение = этот филиал", () => {
    assert.deepEqual(
      groupBranchWhere({ branchId: BR_A, allowedBranchIds: [BR_A, BR_B] }),
      { branchId: BR_A },
    )
  })

  it("админ подсунул ЧУЖОЙ филиал → заведомо пустая выборка, не весь тенант", () => {
    const where = groupBranchWhere({ branchId: BR_C, allowedBranchIds: [BR_A, BR_B] })
    assert.deepEqual(where, { branchId: { in: [] } })
    // Ключевая гарантия: фильтр НЕ схлопывается в null и не превращается
    // в { branchId: BR_C } — иначе чужой филиал попал бы в выписку.
    assert.notEqual(where, null)
  })

  it("пустой список филиалов → ни одного филиала (а не «все»)", () => {
    assert.deepEqual(groupBranchWhere({ allowedBranchIds: [] }), { branchId: { in: [] } })
  })
})
