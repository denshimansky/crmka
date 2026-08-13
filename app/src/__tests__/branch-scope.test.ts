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
  scopePaymentByAccount,
  scopeExpense,
  scopeFinancialAccount,
  scopeBookableAccount,
  scopeAccountOperation,
  scopeRoom,
  scopeEmployee,
  scopeTrialLesson,
  canAccessBranch,
  canAccessLessonAsInstructor,
} from "../lib/branch-scope"
import { scopeClientByBranch, clientInBranch } from "../lib/client-segments"

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
    ["scopePaymentByAccount", () => scopePaymentByAccount(scope)],
    ["scopeExpense", () => scopeExpense(scope)],
    ["scopeFinancialAccount", () => scopeFinancialAccount(scope)],
    ["scopeBookableAccount", () => scopeBookableAccount(scope)],
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

  // ADM-04 (23.07.2026): общие счета (branchId=NULL) СТРОГО скрыты у скоуп-админа
  // на отображении балансов — только счета своих филиалов.
  it("scopeFinancialAccount — СТРОГО branchId IN [A] (без общих счетов)", () => {
    assert.deepEqual(scopeFinancialAccount(scope), { branchId: { in: [BR_A] } })
  })

  // Селектор «на что можно провести оплату/расход»: общий счёт остаётся выбираемым.
  it("scopeBookableAccount — branchId IN [A] OR IS NULL (общий счёт выбираем)", () => {
    assert.deepEqual(scopeBookableAccount(scope), {
      OR: [{ branchId: { in: [BR_A] } }, { branchId: null }],
    })
  })

  // Видимость оплат — по филиалу КЛИЕНТА (мультифилиальная логика), не по счёту.
  it("scopePayment — по клиенту (scopeClientByBranch) ИЛИ по группе абонемента", () => {
    const result = scopePayment(scope) as { OR: any[] }
    assert.equal(result.OR.length, 2)
    // 1-я ветка — { client: <scopeClientByBranch> } (сегментная видимость).
    const clientBranch = result.OR.find((c) => c.client)
    assert.ok(clientBranch)
    assert.deepEqual(clientBranch.client, scopeClientByBranch(scope))
    // 2-я ветка — страховка по группе абонемента.
    const subBranch = result.OR.find((c) => c.subscription)
    assert.deepEqual(subBranch.subscription, { group: { branchId: { in: [BR_A] } } })
  })

  // Денежно-потоковые представления (ДДС, итоги по кассам, прочий доход P&L):
  // оплаты по ВИДИМОМУ счёту — движения по общим счетам скрыты.
  it("scopePaymentByAccount — account.branchId IN [A]", () => {
    assert.deepEqual(scopePaymentByAccount(scope), {
      account: { branchId: { in: [BR_A] } },
    })
  })

  // Операции между счетами: видны, только если хотя бы один счёт в scope —
  // операции целиком по общим счетам (оба NULL) скрыты (нет ветки branchId:null).
  it("scopeAccountOperation — только from/to в scope, без общих счетов", () => {
    assert.deepEqual(scopeAccountOperation(scope), {
      OR: [
        { fromAccount: { branchId: { in: [BR_A] } } },
        { toAccount: { branchId: { in: [BR_A] } } },
      ],
    })
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

describe("scopeClientByBranch (модель Анны — 1–2 ручных филиала)", () => {
  it("mode all → no-op {} (владелец/управляющий видят всех)", () => {
    const scope = branchScopeFromSession(null)
    assert.deepEqual(scopeClientByBranch(scope), {})
  })

  it("coversAllBranches (админ со всеми филиалами) → {} (видит всех, вкл. безфилиальных)", () => {
    const scope = {
      mode: "limited" as const,
      branchIds: [BR_A, BR_B],
      coversAllBranches: true,
    }
    assert.deepEqual(scopeClientByBranch(scope), {})
  })

  it("частичный scope → OR из 3: branchId, secondBranchId, живой абонемент", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    assert.equal(result.OR.length, 3)
    // Поле 1 карточки.
    assert.ok(
      result.OR.some(
        (c) => c.branchId && Array.isArray(c.branchId.in) && c.branchId.in.includes(BR_A),
      ),
    )
    // Поле 2 карточки.
    assert.ok(
      result.OR.some(
        (c) => c.secondBranchId && Array.isArray(c.secondBranchId.in) && c.secondBranchId.in.includes(BR_A),
      ),
    )
    // Страховка по живому абонементу.
    const live = result.OR.find((c) => c.subscriptions)
    assert.ok(live)
    assert.deepEqual(live.subscriptions.some.status, { in: ["pending", "active"] })
    assert.equal(live.subscriptions.some.deletedAt, null)
    assert.deepEqual(live.subscriptions.some.group, { branchId: { in: [BR_A] } })
  })

  // Ключевое отличие от прежней модели: безфилиального клиента (оба поля NULL,
  // без живого абонемента) частичный scope НЕ видит — нет ветки branchId:null.
  // Его видят только владелец/управляющий/админ со всеми филиалами.
  it("частичный scope НЕ показывает безфилиального клиента (нет ветки *:null)", () => {
    const result = scopeClientByBranch(branchScopeFromSession([BR_A])) as { OR: any[] }
    assert.ok(
      !result.OR.some((c) => c.branchId === null || c.secondBranchId === null),
    )
  })

  it("clientInBranch — тот же предикат, что и частичный scope (единая точка правды)", () => {
    const scope = branchScopeFromSession([BR_A])
    assert.deepEqual(scopeClientByBranch(scope), clientInBranch([BR_A]))
  })

  it("clientInBranch([]) — deny: OR c пустыми in, никого не матчит", () => {
    const result = clientInBranch([]) as { OR: any[] }
    assert.equal(result.OR.length, 3)
    assert.deepEqual(result.OR[0], { branchId: { in: [] } })
  })
})
