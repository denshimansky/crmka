/**
 * Гейтинг виджетов дашборда: показ (`show`) + кликабельность ссылки (`link`).
 *
 * Решение владельца 23.07.2026 — у админа (по умолчанию без reports.* и
 * finance.result) дашборд должен содержать операционные виджеты, но:
 *   • отчётные виджеты (Воронка/Активные абонементы/Заполняемость/Отработанные)
 *     показываются ВСЕГДА, а заголовок делинкуется, если отчёт закрыт;
 *   • финансовые/отчётные виджеты со `show` (KPI-строка, Ожидаемые поступления,
 *     Прогноз прибыли, Остатки денег, Плановые расходы) у админа скрыты, а у
 *     ролей с доступом (владелец/управляющий/«только чтение») — видны и кликабельны.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { hasPermission } from "../lib/permissions"
import {
  DASHBOARD_WIDGET_GATES,
  STAT_CARD_PERMISSIONS,
} from "../lib/dashboard/widget-permissions"
import { requiredPermissionForPath } from "../lib/route-permissions"

// Тип роли берём из сигнатуры hasPermission — без импорта Role из @prisma/client.
type Role = Parameters<typeof hasPermission>[0]
const role = (r: string) => r as Role

// Ссылка каждого виджета (как в page.tsx). Для отчётных виджетов с делинком
// (`link != null`) право ссылки обязано совпасть с правом страницы по route-permissions.
const WIDGET_LINKS: Record<string, string | null> = {
  stats: null,
  tasks: "/tasks",
  expectedIncome: "/reports/finance/expected-income",
  activeSubs: "/reports/crm/active-subs-dynamics",
  profitForecast: "/reports/finance/pnl",
  missedTrials: "/crm/sales",
  unmarked: "/schedule",
  funnel: "/reports/crm/funnel",
  capacity: "/reports/schedule/capacity",
  cashBalances: "/finance/cash",
  birthdays: null,
  workedSubs: "/reports/finance/revenue",
  plannedExpenses: "/finance/planned-expenses",
}

const STAT_LINKS: Record<keyof typeof STAT_CARD_PERMISSIONS, string> = {
  activeSubscriptions: "/crm/contacts",
  income: "/finance/dds",
  expenses: "/finance/expenses",
  debtors: "/finance/debtors",
}

// Показан ли виджет роли (show=null → всегда).
const shown = (r: string, id: string) => {
  const g = DASHBOARD_WIDGET_GATES[id]
  return g.show == null || hasPermission(role(r), g.show)
}
// Кликабелен ли заголовок-ссылка на отчёт (link=null → всегда/нет ссылки).
const linkClickable = (r: string, id: string) => {
  const g = DASHBOARD_WIDGET_GATES[id]
  return g.link == null || hasPermission(role(r), g.link)
}
const statVisible = (r: string, key: keyof typeof STAT_CARD_PERMISSIONS) =>
  hasPermission(role(r), STAT_CARD_PERMISSIONS[key])

describe("Структура гейтов виджетов", () => {
  it("гейты покрывают ровно те же id, что и карта ссылок", () => {
    assert.deepEqual(
      Object.keys(DASHBOARD_WIDGET_GATES).sort(),
      Object.keys(WIDGET_LINKS).sort(),
    )
  })

  it("право ссылки делинк-виджета совпадает с правом его страницы", () => {
    for (const [id, g] of Object.entries(DASHBOARD_WIDGET_GATES)) {
      if (g.link == null) continue
      const link = WIDGET_LINKS[id]
      assert.ok(link, `у делинк-виджета "${id}" должна быть ссылка`)
      assert.equal(
        g.link,
        requiredPermissionForPath(link!),
        `виджет "${id}" (${link}) — право ссылки должно совпасть с правом страницы`,
      )
    }
  })

  it("каждая карточка-метрика гейтится правом своей страницы", () => {
    for (const [key, link] of Object.entries(STAT_LINKS)) {
      assert.equal(
        STAT_CARD_PERMISSIONS[key as keyof typeof STAT_CARD_PERMISSIONS],
        requiredPermissionForPath(link),
        `карточка "${key}" (${link}) должна гейтиться правом страницы`,
      )
    }
  })
})

describe("Дашборд администратора (дефолтные права)", () => {
  const HIDDEN = ["stats", "expectedIncome", "profitForecast", "cashBalances", "plannedExpenses"]
  const VISIBLE = ["tasks", "missedTrials", "unmarked", "birthdays", "funnel", "activeSubs", "capacity", "workedSubs"]
  const DELINKED = ["funnel", "activeSubs", "capacity", "workedSubs"]

  it("скрыты финансовые/отчётные виджеты со `show`", () => {
    for (const id of HIDDEN) {
      assert.equal(shown("admin", id), false, `виджет "${id}" должен быть скрыт у админа`)
    }
  })

  it("показаны операционные и отчётные (без `show`) виджеты", () => {
    for (const id of VISIBLE) {
      assert.equal(shown("admin", id), true, `виджет "${id}" должен быть виден админу`)
    }
  })

  it("отчётные виджеты показаны, но заголовок НЕ кликабелен (делинк)", () => {
    for (const id of DELINKED) {
      assert.equal(shown("admin", id), true, `"${id}" показан`)
      assert.equal(linkClickable("admin", id), false, `"${id}" — ссылка на отчёт неактивна`)
    }
  })

  it("операционные ссылки (задачи/пробники/расписание) активны", () => {
    for (const id of ["tasks", "missedTrials", "unmarked"]) {
      assert.equal(linkClickable("admin", id), true, `"${id}" — ссылка активна`)
    }
  })
})

describe("Дашборд владельца/управляющего/только-чтение (дефолтные права)", () => {
  it("owner, manager, readonly видят ВСЕ виджеты и все ссылки кликабельны", () => {
    for (const r of ["owner", "manager", "readonly"]) {
      for (const id of Object.keys(DASHBOARD_WIDGET_GATES)) {
        assert.equal(shown(r, id), true, `${r}: виджет "${id}" должен быть виден`)
        assert.equal(linkClickable(r, id), true, `${r}: ссылка "${id}" должна быть активна`)
      }
    }
  })

  it("readonly видит все карточки KPI-строки (в т.ч. «Доходы»)", () => {
    for (const key of Object.keys(STAT_CARD_PERMISSIONS) as (keyof typeof STAT_CARD_PERMISSIONS)[]) {
      assert.equal(statVisible("readonly", key), true, `readonly: карточка "${key}" видна`)
    }
  })
})
