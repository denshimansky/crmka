/**
 * ADM-04: филиальный scope видимости задач (дашборд + /tasks + /api/tasks).
 *
 * Проверяем, что задачи скоуп-админа режутся по филиалу, а владелец/управляющий
 * и админ БЕЗ привязок (scope="all") видят все задачи как раньше.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { Role } from "@prisma/client"
import { taskVisibilityWhere, seesAllTasks } from "../lib/tasks/task-visibility"
import { scopeTaskByBranch } from "../lib/branch-scope"

const role = (r: string) => r as Role
const allScope = { mode: "all" as const }
const limited = { mode: "limited" as const, branchIds: ["b1", "b2"] }

describe("taskVisibilityWhere — роль без филиала (обратная совместимость)", () => {
  it("владелец/управляющий/админ без scope → {} (все задачи)", () => {
    assert.deepEqual(taskVisibilityWhere(role("owner"), "e1"), {})
    assert.deepEqual(taskVisibilityWhere(role("manager"), "e1"), {})
    assert.deepEqual(taskVisibilityWhere(role("admin"), "e1"), {})
  })

  it("инструктор/только чтение без scope → только свои (assignedTo)", () => {
    assert.deepEqual(taskVisibilityWhere(role("instructor"), "e1"), { assignedTo: "e1" })
    assert.deepEqual(taskVisibilityWhere(role("readonly"), "e1"), { assignedTo: "e1" })
  })

  it("нет employeeId у не-управленца → неподбираемый UUID (чужое не показываем)", () => {
    const w = taskVisibilityWhere(role("instructor"), null)
    assert.deepEqual(w, { assignedTo: "00000000-0000-0000-0000-000000000000" })
  })
})

describe("taskVisibilityWhere — филиальный scope", () => {
  it("scope='all' — no-op даже для админа (нет привязок → видит все)", () => {
    assert.deepEqual(taskVisibilityWhere(role("admin"), "e1", allScope), {})
    assert.deepEqual(taskVisibilityWhere(role("owner"), "e1", allScope), {})
  })

  it("админ с привязкой → только branch-scope (роль 'все' → нет верхнего assignedTo)", () => {
    const w = taskVisibilityWhere(role("admin"), "e1", limited)
    // Роль admin видит все задачи, поэтому итог = чистый branch-scope (OR),
    // без обёртки AND по роли.
    assert.ok("OR" in w, "должен быть OR branch-scope")
    assert.ok(!("AND" in w), "AND по роли не нужен (роль видит все)")
  })

  it("инструктор с привязкой → AND(свои, branch-scope)", () => {
    const w = taskVisibilityWhere(role("instructor"), "e1", limited)
    assert.ok(Array.isArray((w as any).AND), "должен быть AND роль+филиал")
    assert.equal((w as any).AND.length, 2)
    assert.deepEqual((w as any).AND[0], { assignedTo: "e1" })
    assert.ok("OR" in (w as any).AND[1], "второй член AND — branch-scope OR")
  })
})

// Регресс (баг «Исаева видит 1 задачу вместо 12», 17.08.2026): админ, у которого
// отмечены ВСЕ живые филиалы (coversAllBranches), для видимости клиентов = «видит
// всех», включая безфилиальных. Плечо client в OR должно быть { isNot: null }
// (любая задача с клиентом), а НЕ сегментное clientInBranch. Баг был не в этой
// функции, а в вызовах (sync branchScopeFromSession не считал coversAllBranches) —
// тест фиксирует ожидаемое поведение при корректно посчитанном scope.
describe("taskVisibilityWhere/scopeTaskByBranch — coversAllBranches (админ со всеми филиалами)", () => {
  const coversAll = {
    mode: "limited" as const,
    branchIds: ["b1", "b2"],
    coversAllBranches: true,
  }

  it("админ со всеми филиалами → плечо client = { isNot: null } (видит задачи о любом клиенте)", () => {
    const w = scopeTaskByBranch(coversAll, "e1") as { OR: any[] }
    const clientArm = w.OR.find((c) => "client" in c)
    assert.ok(clientArm, "должно быть плечо по client")
    assert.deepEqual(clientArm.client, { isNot: null })
    assert.notDeepEqual(clientArm.client, {}, "пустой фильтр связи роняется Prisma")
  })

  it("taskVisibilityWhere(admin, coversAll) → чистый OR, плечо client = { isNot: null }", () => {
    const w = taskVisibilityWhere(role("admin"), "e1", coversAll) as { OR: any[] }
    assert.ok("OR" in w, "роль admin видит все → без AND-обёртки, только branch-OR")
    const clientArm = w.OR.find((c) => "client" in c)
    assert.deepEqual(clientArm.client, { isNot: null })
  })
})

describe("scopeTaskByBranch — структура правил", () => {
  it("scope='all' → {} (no-op)", () => {
    assert.deepEqual(scopeTaskByBranch(allScope, "e1"), {})
  })

  it("ограниченный scope → OR из трёх правил: я / клиент филиала / явный branchId", () => {
    const w = scopeTaskByBranch(limited, "e1")
    const or = (w as any).OR as any[]
    assert.ok(Array.isArray(or) && or.length === 3)
    // Правило 1 — назначена лично мне.
    assert.deepEqual(or[0], { assignedTo: "e1" })
    // Правило 2 — по клиенту (реляционный фильтр client).
    assert.ok("client" in or[1])
    // Правило 3 — явный филиал задачи (unmarked_lesson): branchId в scope.
    assert.deepEqual(or[2], { branchId: { in: ["b1", "b2"] } })
  })

  it("нет employeeId → правило 'назначена мне' с неподбираемым UUID", () => {
    const w = scopeTaskByBranch(limited, null)
    assert.deepEqual((w as any).OR[0], { assignedTo: "00000000-0000-0000-0000-000000000000" })
  })
})

describe("seesAllTasks — без изменений", () => {
  it("управленцы видят все", () => {
    for (const r of ["owner", "manager", "admin"]) assert.equal(seesAllTasks(role(r)), true)
  })
  it("инструктор/только чтение — нет", () => {
    for (const r of ["instructor", "readonly"]) assert.equal(seesAllTasks(role(r)), false)
  })
})
