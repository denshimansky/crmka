import type { PermissionKey } from "@/lib/permissions"

/**
 * Право доступа, гейтящее каждый виджет дашборда. Ключ = id виджета
 * (совпадает с DEFAULT_WIDGETS в dashboard-settings и с блоками в page.tsx).
 *
 * Значение — то же право, что закрывает связанную страницу/отчёт в
 * route-permissions.ts: виджет показываем на дашборде ⇔ роль может открыть
 * страницу по ссылке виджета. Так, например, у администратора (по умолчанию
 * без finance.result и reports.*) не будет ни «Воронки продаж», ни
 * «Ожидаемых поступлений», ни «Прогноза прибыли» — как и самих этих страниц.
 *
 * null — у виджета нет единого права:
 *   • `stats` — композит из карточек, каждая фильтруется своим правом
 *     (см. STAT_CARD_PERMISSIONS и page.tsx).
 */
export const DASHBOARD_WIDGET_PERMISSIONS: Record<string, PermissionKey | null> = {
  stats: null,
  tasks: "tasks.view", // /tasks
  expectedIncome: "reports.finance", // /reports/finance/expected-income
  activeSubs: "reports.marketing", // /reports/crm/active-subs-dynamics
  profitForecast: "reports.finance", // /reports/finance/pnl
  missedTrials: "clients.view", // /crm/sales — данные лидов
  unmarked: "schedule.view", // /schedule
  funnel: "reports.marketing", // /reports/crm/funnel
  capacity: "reports.schedule", // /reports/schedule/capacity
  cashBalances: "finance.view", // /finance/cash
  birthdays: "clients.view", // ДР детей (клиентов) + сотрудников
  workedSubs: "reports.finance", // /reports/finance/revenue
  plannedExpenses: "finance.view", // /finance/planned-expenses
}

/**
 * Право доступа для каждой карточки-метрики верхнего блока `stats`.
 * Карточки фильтруются поштучно: у админа по умолчанию нет finance.result,
 * поэтому карточка «Доходы» (/finance/dds) скрывается, а «Расходы»/«Должники»
 * (/finance*, finance.view) и «Активные абонементы» (/crm, clients.view)
 * остаются.
 */
export const STAT_CARD_PERMISSIONS = {
  activeSubscriptions: "clients.view", // /crm/contacts?tab=active
  income: "finance.result", // /finance/dds?kind=income
  expenses: "finance.view", // /finance/expenses
  debtors: "finance.view", // /finance/debtors
} as const satisfies Record<string, PermissionKey>
