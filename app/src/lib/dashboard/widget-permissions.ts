import type { PermissionKey } from "@/lib/permissions"

/**
 * Политика виджета дашборда: показ + кликабельность ссылки на отчёт.
 * Ключ = id виджета (совпадает с DEFAULT_WIDGETS в dashboard-settings и с
 * блоками в page.tsx).
 *
 * Решение владельца 23.07.2026 — у админа (по умолчанию без reports.* и
 * finance.result) дашборд должен содержать операционные виджеты, но:
 *   • отчётные виджеты показываем ВСЕГДА, а ссылку на отчёт делаем неактивной,
 *     если у роли нет доступа к отчёту (`link`);
 *   • «тяжёлые» финансовые/отчётные виджеты скрываем совсем, если нет права
 *     (`show`): «Ключевые показатели», «Ожидаемые поступления», «Прогноз
 *     прибыли», «Остатки денег», «Плановые расходы».
 * У владельца/управляющего и роли «только чтение» (есть доступ к отчётам и
 * финрезультату) всё видно и кликабельно.
 */
export interface WidgetGate {
  /** Право на ПОКАЗ виджета. null — показываем всегда. */
  show: PermissionKey | null
  /**
   * Право на КЛИКАБЕЛЬНОСТЬ ссылки на отчёт/раздел. null — ссылка всегда
   * активна (или у виджета вовсе нет ссылки на закрываемый раздел). Если у
   * роли нет этого права — заголовок рендерится текстом, без перехода.
   */
  link: PermissionKey | null
}

export const DASHBOARD_WIDGET_GATES: Record<string, WidgetGate> = {
  // KPI-строка — у админа скрыта целиком (нет finance.result), у ролей с
  // финрезультатом видна; карточки дополнительно фильтруются поштучно
  // (см. STAT_CARD_PERMISSIONS).
  stats: { show: "finance.result", link: null },
  tasks: { show: "tasks.view", link: null }, // /tasks — ссылка = право показа
  // Скрываем, если закрыт блок финансовых отчётов.
  expectedIncome: { show: "reports.finance", link: null }, // /reports/finance/expected-income
  profitForecast: { show: "reports.finance", link: null }, // /reports/finance/pnl
  // Финвиджеты кассы/плана — скрываем без финрезультата.
  cashBalances: { show: "finance.result", link: null }, // /finance/cash
  plannedExpenses: { show: "finance.result", link: null }, // /finance/planned-expenses
  // Показываем всегда; ссылка на отчёт — только при доступе к блоку.
  funnel: { show: null, link: "reports.marketing" }, // /reports/crm/funnel
  activeSubs: { show: null, link: "reports.marketing" }, // /reports/crm/active-subs-dynamics
  capacity: { show: null, link: "reports.schedule" }, // /reports/schedule/capacity
  workedSubs: { show: null, link: "reports.finance" }, // /reports/finance/revenue
  // Операционные виджеты: право показа = право страницы по ссылке, поэтому
  // отдельного делинка не нужно (показан → ссылка доступна).
  missedTrials: { show: "clients.view", link: null }, // /crm/sales
  unmarked: { show: "schedule.view", link: null }, // /schedule
  birthdays: { show: "clients.view", link: null }, // ДР детей (клиентов) + сотрудников
}

/**
 * Право доступа для каждой карточки-метрики верхнего блока `stats`.
 * Карточки фильтруются поштучно (у роли с finance.result, но без finance.view
 * скрылись бы «Расходы»/«Должники» и т.п.). Сам блок stats показывается только
 * при finance.result (см. DASHBOARD_WIDGET_GATES.stats).
 */
export const STAT_CARD_PERMISSIONS = {
  activeSubscriptions: "clients.view", // /crm/contacts?tab=active
  income: "finance.result", // /finance/dds?kind=income
  expenses: "finance.view", // /finance/expenses
  debtors: "finance.view", // /finance/debtors
} as const satisfies Record<string, PermissionKey>
