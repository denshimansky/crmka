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

describe("scopeClientByBranch (сегментная видимость)", () => {
  it("mode all → no-op {}", () => {
    const scope = branchScopeFromSession(null)
    assert.deepEqual(scopeClientByBranch(scope), {})
  })

  it("limited → OR из 10 сегментов (баг #79 — правило двух филиалов)", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: object[] }
    // 1. Лид + branchId(IN OR NULL)
    // 2. Живой абонемент (pending/active) — все филиалы
    // 3. Активная заявка в scope-филиале
    // 4. Два последних РАЗНЫХ филиала абонементов (last/prev) — безусловно
    // 5. Активный без истории абонементов + branchId(IN OR NULL)
    // 6. Выбывший без истории + branchId(IN OR NULL)
    // 7. Потенциал + applications
    // 8. Архив без истории → все
    // 9. ЧС без истории → все
    // 10. Нецелевой (без ограничения)
    assert.equal(result.OR.length, 10)
  })

  // Баг #79: безусловное правило «два последних РАЗНЫХ филиала» — клиент виден
  // админам обоих своих филиалов (last/prev в scope) независимо от сегмента.
  it("сегмент «два филиала» — lastBranchId ИЛИ prevBranchId в scope, без условия по статусу", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const twoBranch = result.OR.find(
      (c) =>
        Array.isArray(c.OR) &&
        c.OR.length === 2 &&
        c.OR.some((b: any) => Array.isArray(b.lastBranchId?.in)) &&
        c.OR.some((b: any) => Array.isArray(b.prevBranchId?.in)) &&
        !("funnelStatus" in c) &&
        !("clientStatus" in c),
    )
    assert.ok(twoBranch)
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
    const lead = result.OR.find((c) => c.funnelStatus?.in)
    assert.ok(lead)
    assert.ok(lead.OR)
    assert.equal(lead.OR.length, 2)
    // Один из вариантов — branchId IS NULL.
    assert.ok(lead.OR.some((b: any) => b.branchId === null))
  })

  // Регрессия: лид с выписанным (pending) абонементом пропадал у филиального
  // админа — правило «лид» требовало totalSubscriptionsCount=0, а правило
  // «активный» — строго active-абонемент. Клиенты на «Ожидаем оплату»
  // с выписанным абонементом были невидимы даже админу своего филиала.
  it("сегмент «лид» — не требует totalSubscriptionsCount=0", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const lead = result.OR.find((c) => c.funnelStatus?.in)
    assert.ok(lead)
    assert.equal("totalSubscriptionsCount" in lead, false)
  })

  it("сегмент «живой абонемент» — pending и active, без условия clientStatus", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const withSub = result.OR.find((c) => c.subscriptions)
    assert.ok(withSub)
    assert.deepEqual(withSub.subscriptions.some.status, {
      in: ["pending", "active"],
    })
    assert.deepEqual(withSub.subscriptions.some.group, { branchId: { in: [BR_A] } })
    assert.equal("clientStatus" in withSub, false)
  })

  // Регрессия (баг Фирова, 14.07.2026): уже купивший клиент (active_client),
  // который привёл ребёнка на новое направление, пропадал из «Продаж» и «Связи»
  // у админа своего филиала — правило «лид» требует лидовый funnelStatus,
  // правило «живой абонемент» — pending/active-абонемент, которого у клиента
  // с разовыми посещениями нет вовсе.
  it("сегмент «активная заявка» — заявка scope-филиала видна, кроме архива/ЧС", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const withApp = result.OR.find((c) => c.applications?.some?.status === "active")
    assert.ok(withApp)
    assert.deepEqual(withApp.applications.some.branchId, { in: [BR_A] })
    assert.equal(withApp.applications.some.deletedAt, null)
    // Архив/ЧС исключены: зависшая заявка не должна давать вечную видимость
    // в обход правил архива и чёрного списка.
    assert.deepEqual(withApp.funnelStatus, { notIn: ["archived", "blacklisted"] })
    // По clientStatus правило не ограничивает: выбывший с открытой заявкой
    // в моём филиале — рабочий набор (возврат в процессе).
    assert.equal("clientStatus" in withApp, false)
  })

  // Баг #79: «активный без истории абонементов» — оба денормализованных филиала
  // NULL (клиент с абонементами покрыт правилом двух филиалов). Фолбэк на
  // Client.branchId (NULL → видят все).
  it("сегмент «активный без истории» — оба филиала NULL, фолбэк branchId IN OR IS NULL", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const active = result.OR.find((c) => c.funnelStatus === "active_client")
    assert.ok(active)
    assert.equal(active.lastBranchId, null)
    assert.equal(active.prevBranchId, null)
    const [statusOr, branchOr] = active.AND
    // Работающие клиенты: clientStatus active ИЛИ NULL (API не гарантирует
    // пару funnelStatus/clientStatus); выбывшими управляет правило «выбывший».
    assert.ok(statusOr.OR.some((s: any) => s.clientStatus === "active"))
    assert.ok(statusOr.OR.some((s: any) => s.clientStatus === null))
    assert.ok(branchOr.OR.some((b: any) => b.branchId === null))
    assert.ok(
      branchOr.OR.some((b: any) => {
        return b.branchId && typeof b.branchId === "object" && Array.isArray(b.branchId.in)
      }),
    )
  })

  // Регрессия: перевод в архив ставит funnelStatus=archived и ОБНУЛЯЕТ
  // clientStatus (movingToArchived в PATCH /api/clients/[id]) — правило,
  // смотревшее только на clientStatus=archived, не матчило ни одного
  // реального архивного клиента. Баг #79: архив С историей абонементов покрыт
  // правилом двух филиалов; здесь — архив БЕЗ истории (оба филиала NULL) → все.
  it("сегмент «архив без истории» — funnelStatus/clientStatus archived + оба филиала NULL", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const archived = result.OR.find((c) =>
      c.AND?.some((p: any) => p.OR?.some((s: any) => s.funnelStatus === "archived")),
    )
    assert.ok(archived)
    const statusOr = archived.AND.find((p: any) => p.OR)
    assert.ok(statusOr.OR.some((s: any) => s.clientStatus === "archived"))
    const noHistory = archived.AND.find((p: any) => "lastBranchId" in p)
    assert.equal(noHistory.lastBranchId, null)
    assert.equal(noHistory.prevBranchId, null)
  })

  // Баг #79: выбывший С историей абонементов виден по правилу двух филиалов
  // (last/prev). Здесь — выбывший БЕЗ истории (оба филиала NULL) → фолбэк на
  // Client.branchId (NULL → видят все, решение владельца 14.07.2026).
  it("сегмент «выбывший без истории» — оба филиала NULL, фолбэк branchId (NULL → все)", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const churned = result.OR.find((c) => c.clientStatus === "churned")
    assert.ok(churned)
    assert.equal(churned.lastBranchId, null)
    assert.equal(churned.prevBranchId, null)
    assert.ok(churned.OR.some((b: any) => b.branchId === null))
    assert.ok(churned.OR.some((b: any) => Array.isArray(b.branchId?.in)))
  })

  // Баг #79: ЧС С историей — правило двух филиалов; БЕЗ истории → все.
  it("сегмент «ЧС без истории» — blacklisted + оба филиала NULL → все", () => {
    const scope = branchScopeFromSession([BR_A])
    const result = scopeClientByBranch(scope) as { OR: any[] }
    const bl = result.OR.find((c) => c.funnelStatus === "blacklisted")
    assert.ok(bl)
    assert.equal(bl.lastBranchId, null)
    assert.equal(bl.prevBranchId, null)
  })
})
