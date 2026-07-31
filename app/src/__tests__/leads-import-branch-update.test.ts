/**
 * Unit-тесты решения об обновлении филиала при merge существующего клиента
 * (этап 2 импорта, decideBranchUpdate). Чистая логика без БД.
 *
 * Правило (после фикса «филиал не привязывается при переимпорте», Monkey Space):
 *  - пустой филиал в БД → проставляем из файла (бэкфилл, как раньше);
 *  - непустой, но клиент БЕЗ абонементов → филиал был проставлен импортом,
 *    разрешаем КОРРЕКЦИЮ из файла (иначе ошибочный первый импорт не исправить);
 *  - клиент С абонементами → филиал производный от абонементов (ADM-04),
 *    импорт его не трогает, только фиксирует расхождение (conflictSkipped).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { decideBranchUpdate } from "../lib/leads-import/branch-update"

const A = "branch-a"
const B = "branch-b"

describe("Импорт базы — этап 2: обновление филиала при merge", () => {
  it("файл без филиала → ничего не меняем", () => {
    const d = decideBranchUpdate({ branchId: A, lastBranchId: A, hasSubscriptions: false }, null)
    assert.deepEqual(d, { setBranchId: false, setLastBranchId: false, corrected: false, conflictSkipped: false })
  })

  it("пустой филиал в БД → бэкфилл из файла (даже с абонементами)", () => {
    const d = decideBranchUpdate({ branchId: null, lastBranchId: null, hasSubscriptions: true }, A)
    assert.equal(d.setBranchId, true)
    assert.equal(d.setLastBranchId, true)
    assert.equal(d.corrected, false) // был null → это не «коррекция»
    assert.equal(d.conflictSkipped, false)
  })

  it("тот же филиал → ничего не меняем", () => {
    const d = decideBranchUpdate({ branchId: A, lastBranchId: A, hasSubscriptions: false }, A)
    assert.deepEqual(d, { setBranchId: false, setLastBranchId: false, corrected: false, conflictSkipped: false })
  })

  it("другой филиал, клиент БЕЗ абонементов → коррекция из файла", () => {
    const d = decideBranchUpdate({ branchId: A, lastBranchId: A, hasSubscriptions: false }, B)
    assert.equal(d.setBranchId, true)
    assert.equal(d.setLastBranchId, true)
    assert.equal(d.corrected, true)
    assert.equal(d.conflictSkipped, false)
  })

  it("другой филиал, клиент С абонементами → не трогаем, фиксируем расхождение", () => {
    const d = decideBranchUpdate({ branchId: A, lastBranchId: A, hasSubscriptions: true }, B)
    assert.equal(d.setBranchId, false)
    assert.equal(d.setLastBranchId, false)
    assert.equal(d.corrected, false)
    assert.equal(d.conflictSkipped, true)
  })

  it("другой lastBranchId, пустой branchId, без абонементов → бэкфилл branchId + коррекция lastBranchId", () => {
    const d = decideBranchUpdate({ branchId: null, lastBranchId: A, hasSubscriptions: false }, B)
    assert.equal(d.setBranchId, true)
    assert.equal(d.setLastBranchId, true)
    assert.equal(d.corrected, true) // lastBranchId был непустой и меняется
  })
})
