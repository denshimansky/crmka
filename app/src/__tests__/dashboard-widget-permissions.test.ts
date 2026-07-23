/**
 * Гейтинг виджетов дашборда по правам роли. Виджет (и отдельная карточка-метрика)
 * показывается только если у роли есть доступ к связанному разделу/отчёту — тем
 * же правом, что закрывает саму страницу в route-permissions.ts.
 *
 * Баг: администратор видел ВСЕ виджеты дашборда, включая закрытые для него
 * отчёты и финрезультат («Воронка», «Ожидаемые поступления», «Прогноз прибыли»,
 * «Заполняемость», «Отработанные абонементы», карточка «Доходы»).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { hasPermission } from "../lib/permissions"
import {
  DASHBOARD_WIDGET_PERMISSIONS,
  STAT_CARD_PERMISSIONS,
} from "../lib/dashboard/widget-permissions"
import { requiredPermissionForPath } from "../lib/route-permissions"

// Тип роли берём из сигнатуры hasPermission — без импорта Role из @prisma/client.
type Role = Parameters<typeof hasPermission>[0]

// Ссылка каждого виджета (как в page.tsx) — источник истины для сверки:
// право виджета обязано совпасть с правом, гейтящим страницу по этой ссылке.
// null — у виджета нет прямой ссылки на страницу (`stats` — композит,
// `birthdays` — данные детей-клиентов без отдельной страницы).
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

// Роли, которым отдаётся дашборд с виджетами (педагог получает упрощённую
// главную и здесь не участвует).
const role = (r: string) => r as Role

describe("Виджеты дашборда: право виджета совпадает с правом связанной страницы", () => {
  it("каждый виджет со ссылкой гейтится тем же правом, что и его страница", () => {
    for (const [id, link] of Object.entries(WIDGET_LINKS)) {
      if (link == null) continue
      assert.equal(
        DASHBOARD_WIDGET_PERMISSIONS[id],
        requiredPermissionForPath(link),
        `виджет "${id}" (${link}) должен гейтиться правом страницы`,
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

  it("карты покрывают одни и те же виджеты (нет рассинхрона id)", () => {
    assert.deepEqual(
      Object.keys(DASHBOARD_WIDGET_PERMISSIONS).sort(),
      Object.keys(WIDGET_LINKS).sort(),
    )
  })
})

// Итоговая видимость: показываем виджет, если у роли есть его право
// (null-право у `stats` — всегда показываем контейнер, карточки решают сами).
const widgetVisible = (r: string, id: string) => {
  const perm = DASHBOARD_WIDGET_PERMISSIONS[id]
  return perm == null || hasPermission(role(r), perm)
}
const statVisible = (r: string, key: keyof typeof STAT_CARD_PERMISSIONS) =>
  hasPermission(role(r), STAT_CARD_PERMISSIONS[key])

describe("Дашборд администратора: закрытые разделы скрыты (дефолтные права)", () => {
  it("скрыты отчётные/финрез-виджеты", () => {
    for (const id of ["funnel", "expectedIncome", "profitForecast", "capacity", "workedSubs", "activeSubs"]) {
      assert.equal(widgetVisible("admin", id), false, `виджет "${id}" должен быть скрыт у админа`)
    }
  })

  it("видны доступные админу виджеты", () => {
    for (const id of ["tasks", "unmarked", "missedTrials", "cashBalances", "birthdays", "plannedExpenses"]) {
      assert.equal(widgetVisible("admin", id), true, `виджет "${id}" должен быть виден админу`)
    }
  })

  it("карточка «Доходы» (finance.result) скрыта, остальные видны", () => {
    assert.equal(statVisible("admin", "income"), false)
    assert.equal(statVisible("admin", "activeSubscriptions"), true)
    assert.equal(statVisible("admin", "expenses"), true)
    assert.equal(statVisible("admin", "debtors"), true)
  })
})

describe("Дашборд владельца/управляющего/только-чтение (дефолтные права)", () => {
  it("owner и manager видят все виджеты и все карточки", () => {
    for (const r of ["owner", "manager"]) {
      for (const id of Object.keys(DASHBOARD_WIDGET_PERMISSIONS)) {
        assert.equal(widgetVisible(r, id), true, `${r}: "${id}" должен быть виден`)
      }
      for (const key of Object.keys(STAT_CARD_PERMISSIONS) as (keyof typeof STAT_CARD_PERMISSIONS)[]) {
        assert.equal(statVisible(r, key), true, `${r}: карточка "${key}" должна быть видна`)
      }
    }
  })

  it("readonly видит все текущие виджеты (ни один не требует reports.salary)", () => {
    for (const id of Object.keys(DASHBOARD_WIDGET_PERMISSIONS)) {
      assert.equal(widgetVisible("readonly", id), true, `readonly: "${id}" должен быть виден`)
    }
    assert.equal(statVisible("readonly", "income"), true)
  })
})
