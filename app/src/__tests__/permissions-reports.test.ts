/**
 * Права на блоки отчётов (баг #77): раздельные reports.* заменили единый
 * reports.view. Проверяем дефолты по ролям и обратную совместимость —
 * пока владелец не пересохранил матрицу, новые ключи наследуют старые
 * (reports.view → marketing/retention/schedule; finance.result → reports.finance;
 * finance.salary → reports.salary). Явно заданный новый ключ побеждает наследование.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { hasPermission, type RolePermissions } from "../lib/permissions"

const REPORTS = [
  "reports.marketing",
  "reports.retention",
  "reports.schedule",
  "reports.finance",
  "reports.salary",
] as const

describe("Права на отчёты — дефолты по ролям", () => {
  it("owner: все блоки открыты", () => {
    for (const k of REPORTS) assert.equal(hasPermission("owner" as any, k), true)
  })
  it("manager: все блоки открыты", () => {
    for (const k of REPORTS) assert.equal(hasPermission("manager" as any, k), true)
  })
  it("admin: все блоки закрыты", () => {
    for (const k of REPORTS) assert.equal(hasPermission("admin" as any, k), false)
  })
  it("instructor: все блоки закрыты", () => {
    for (const k of REPORTS) assert.equal(hasPermission("instructor" as any, k), false)
  })
  it("readonly: открыто всё, кроме зарплатных отчётов", () => {
    assert.equal(hasPermission("readonly" as any, "reports.marketing"), true)
    assert.equal(hasPermission("readonly" as any, "reports.retention"), true)
    assert.equal(hasPermission("readonly" as any, "reports.schedule"), true)
    assert.equal(hasPermission("readonly" as any, "reports.finance"), true)
    assert.equal(hasPermission("readonly" as any, "reports.salary"), false)
  })
})

describe("Права на отчёты — обратная совместимость (наследование старых ключей)", () => {
  // Организация настроила матрицу ДО релиза: у admin включён старый reports.view,
  // finance.result и finance.salary — новые ключи ещё не сохранены.
  const legacyOrg: RolePermissions = {
    // «reports.view» — старый ключ, которого больше нет в PermissionKey (as any).
    admin: {
      "reports.view": true,
      "finance.result": false,
      "finance.salary": true,
    } as any,
  }

  it("reports.marketing/retention/schedule наследуют reports.view", () => {
    assert.equal(hasPermission("admin" as any, "reports.marketing", legacyOrg), true)
    assert.equal(hasPermission("admin" as any, "reports.retention", legacyOrg), true)
    assert.equal(hasPermission("admin" as any, "reports.schedule", legacyOrg), true)
  })
  it("reports.finance наследует finance.result, reports.salary — finance.salary", () => {
    assert.equal(hasPermission("admin" as any, "reports.finance", legacyOrg), false)
    assert.equal(hasPermission("admin" as any, "reports.salary", legacyOrg), true)
  })

  it("старый reports.view=false скрывает блоки (без регрессии доступа)", () => {
    const org: RolePermissions = {
      manager: { "reports.view": false } as any,
    }
    assert.equal(hasPermission("manager" as any, "reports.marketing", org), false)
    assert.equal(hasPermission("manager" as any, "reports.retention", org), false)
  })

  it("явный новый ключ побеждает наследование", () => {
    const org: RolePermissions = {
      admin: { "reports.view": false, "reports.marketing": true } as any,
    }
    assert.equal(hasPermission("admin" as any, "reports.marketing", org), true)
    // остальные всё ещё наследуют reports.view=false
    assert.equal(hasPermission("admin" as any, "reports.retention", org), false)
  })
})
