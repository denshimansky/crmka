/**
 * Unit-тесты для branch-scope и client-segments.
 * ADM-04: разграничение видимости по филиалам.
 *
 * Здесь — чистая логика без БД: проверяем, что хелперы возвращают правильные
 * WHERE-фрагменты для известных комбинаций (scope, сущность).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  branchScopeFromSession,
  isUnscoped,
  scopeBranch,
  scopeGroup,
  scopeLesson,
  scopeLessonForInstructor,
  scopeSubscription,
  scopeApplication,
  scopePayment,
  scopeExpense,
  scopeFinancialAccount,
  scopeAccountOperation,
  scopeRoom,
  scopeEmployee,
  scopeTrialLesson,
  canAccessBranch,
  canAccessLessonAsInstructor,
} from "../lib/branch-scope"
import { scopeClientByBranch } from "../lib/client-segments"

const BR_A = "11111111-1111-1111-1111-111111111111"
const BR_B = "22222222-2222-2222-2222-222222222222"
const EMP_INSTRUCTOR = "33333333-3333-3333-3333-333333333333"

describe("branchScopeFromSession", () => {
  it("null → mode: all", () => {
    const scope = branchScopeFromSession(null)
    assert.equal(scope.mode, "all")
    assert.equal(isUnscoped(scope), true)
  })

  it("undefined → mode: all", () => {
    const scope = branchScopeFromSession(undefined)
    assert.equal(scope.mode, "all")
  })

  it("непустой массив → mode: limited", () => {
    const scope = branchScopeFromSession([BR_A])
    assert.equal(scope.mode, "limited")
    if (scope.mode === "limited") {
      assert.deepEqual(scope.branchIds, [BR_A])
    }
  })

  it("пустой массив → mode: limited с пустым списком (deny-семантика)", () => {
    const scope = branchScopeFromSession([])
    assert.equal(scope.mode, "limited")
    if (scope.mode === "limited") {
      assert.deepEqual(scope.branchIds, [])
    }
  })
})

describe("scope-фрагменты для mode: all → no-op {}", () => {
  const scope = branchScopeFromSession(null)
  const cases: Array<[string, () => object]> = [
    ["scopeBranch", () => scopeBranch(scope)],
    ["scopeGroup", () => scopeGroup(scope)],
    ["scopeLesson", () => scopeLesson(scope)],
    ["scopeSubscription", () => scopeSubscription(scope)],
    ["scopeApplication", () => scopeApplication(scope)],
    ["scopePayment", () => scopePayment(scope)],
    ["scopeExpense", () => scopeExpense(scope)],
    ["scopeFinancialAccount", () => scopeFinancialAccount(scope)],
    ["scopeAccountOperation", () => scopeAccountOperation(scope)],
    ["scopeRoom", () => scopeRoom(scope)],
    ["scopeEmployee", () => scopeEmployee(scope)],
    ["scopeTrialLesson", () => scopeTrialLesson(scope)],
  ]
  for (const [name, fn] of cases) {
    it(`${name} → {} (никаких ограничений)`, () => {
      assert.deepEqual(fn(), {})
    })
  }

  it("scopeLessonForInstructor для роли — всё равно ограничивает по own/substitute", () => {
    // Даже при mode: all (например, для admin с пустыми привязками) — если
    // вызвали для роли instructor, всё равно сужаем по «своим».
    const result = scopeLessonForInstructor(EMP_INSTRUCTOR, scope)
    assert.deepEqual(result, {
      OR: [
        { instructorId: EMP_INSTRUCTOR },
        { substituteInstructorId: EMP_INSTRUCTOR },
      ],
    })
  })
})

describe("scope-фрагменты для mode: limited [A]", () => {
  const scope = branchScopeFromSession([BR_A])

  it("scopeBranch → { id: { in: [A] } }", () => {
    assert.deepEqual(scopeBranch(scope), { id: { in: [BR_A] } })
  })

  it("scopeGroup → branchId IN [A]", () => {
    assert.deepEqual(scopeGroup(scope), { branchId: { in: [BR_A] } })
  })

  it("scopeLesson → через group.branchId", () => {
    assert.deepEqual(scopeLesson(scope), {
      group: { branchId: { in: [BR_A] } },
    })
  })

  it("scopeLessonForInstructor — AND по scope и own", () => {
    const result = scopeLessonForInstructor(EMP_INSTRUCTOR, scope)
    assert.deepEqual(result, {
      AND: [
        { group: { branchId: { in: [BR_A] } } },
        {
          OR: [
            { instructorId: EMP_INSTRUCTOR },
            { substituteInstructorId: EMP_INSTRUCTOR },
          ],
        },
      ],
    })
  })

  it("scopeSubscription → через group.branchId", () => {
    assert.deepEqual(scopeSubscription(scope), {
      group: { branchId: { in: [BR_A] } },
    })
  })

  it("scopeApplication → branchId IN [A] (обязательное поле)", () => {
    assert.deepEqual(scopeApplication(scope), { branchId: { in: [BR_A] } })
  })

  it("scopeFinancialAccount — branchId IN [A] OR IS NULL (общие счета)", () => {
    const result = scopeFinancialAccount(scope)
    assert.deepEqual(result, {
      OR: [{ branchId: { in: [BR_A] } }, { branchId: null }],
    })
  })

  it("scopePayment — оплата через subscription/account или общая", () => {
    const result = scopePayment(scope) as { OR: object[] }
    assert.equal(result.OR.length, 3)
  })

  it("scopeExpense — расход в scope или «общий» (без привязок)", () => {
    const result = scopeExpense(scope) as { OR: object[] }
    assert.equal(result.OR.length, 2)
  })

  it("scopeEmployee — привязан к scope или кросс-филиальный", () => {
    const result = scopeEmployee(scope) as { OR: object[] }
    assert.equal(result.OR.length, 2)
  })

  it("scopeTrialLesson — через group/room или без привязок", () => {
    const result = scopeTrialLesson(scope) as { OR: object[] }
    assert.equal(result.OR.length, 3)
  })
})

describe("runtime проверки canAccess*", () => {
  it("canAccessBranch: mode all → всегда true", () => {
    const scope = branchScopeFromSession(null)
    assert.equal(canAccessBranch(BR_A, scope), true)
    assert.equal(canAccessBranch(BR_B, scope), true)
  })

  it("canAccessBranch: limited → только in", () => {
    const scope = branchScopeFromSession([BR_A])
    assert.equal(canAccessBranch(BR_A, scope), true)
    assert.equal(canAccessBranch(BR_B, scope), false)
  })

  it("canAccessLessonAsInstructor: instructorId совпадает", () => {
    assert.equal(
      canAccessLessonAsInstructor(
        { instructorId: EMP_INSTRUCTOR, substituteInstructorId: null },
        EMP_INSTRUCTOR,
      ),
      true,
    )
  })

  it("canAccessLessonAsInstructor: substitute совпадает", () => {
    assert.equal(
      canAccessLessonAsInstructor(
        { instructorId: "other", substituteInstructorId: EMP_INSTRUCTOR },
        EMP_INSTRUCTOR,
      ),
      true,
    )
  })

  it("canAccessLessonAsInstructor: чужое — false", () => {
    assert.equal(
      canAccessLessonAsInstructor(
        { instructorId: "other", substituteInstructorId: null },
        EMP_INSTRUCTOR,
      ),
      false,
    )
  })
})

describe("scopeClientByBranch (сегментная видимость)", () => {
  it("mode all → no-op {}", () => {
    const scope = branchScopeFromSession(null)
    assert.deepEqual(scopeClientByBranch(scope), {})
  })

  it("limited → OR из 7 сегментов", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: object[] }
    // 1. Лид + branchId(IN OR NULL)
    // 2. Активный + subscriptions.some
    // 3. Выбывший + lastBranchId
    // 4. Потенциал + applications
    // 5. Архив + lastBranchId(IN OR NULL)
    // 6. ЧС + lastBranchId(IN OR NULL)
    // 7. Нецелевой (без ограничения)
    assert.equal(result.OR.length, 7)
  })

  it("сегмент «нецелевой» — без branch-условия", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const nonTarget = result.OR.find((c) => c.funnelStatus === "non_target")
    assert.ok(nonTarget)
    // У нецелевого не должно быть branch-ограничения
    assert.equal(Object.keys(nonTarget).length, 1)
  })

  it("сегмент «лид» — branchId IN OR IS NULL", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const lead = result.OR.find((c) => c.totalSubscriptionsCount === 0)
    assert.ok(lead)
    assert.ok(lead.OR)
    assert.equal(lead.OR.length, 2)
    // Один из вариантов — branchId IS NULL.
    assert.ok(lead.OR.some((b: any) => b.branchId === null))
  })

  it("сегмент «архив» — lastBranchId IN OR IS NULL (видят все, если NULL)", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const archived = result.OR.find((c) => c.clientStatus === "archived")
    assert.ok(archived)
    assert.ok(archived.OR.some((b: any) => b.lastBranchId === null))
  })

  it("сегмент «выбывший» — lastBranchId строго IN scope (NULL не виден)", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const churned = result.OR.find((c) => c.clientStatus === "churned")
    assert.ok(churned)
    // У churned — lastBranchId напрямую in:, без OR с null
    assert.deepEqual(churned.lastBranchId, { in: [BR_A] })
  })
})
