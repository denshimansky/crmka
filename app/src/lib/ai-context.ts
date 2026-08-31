/**
 * Сборка контекста для AI-ассистента CRM.
 *
 * Три блока:
 *   1. NavMap — карта страниц + FAQ по «спрятанным» действиям (статика)
 *   2. BaseContext — расширенный срез метрик организации (Level 1)
 *   3. DynamicSlice — детали по сущностям, упомянутым в вопросе (Level 2)
 *
 * Используется в /api/ai/chat/route.ts.
 */

import { db } from "./db"
import { selectFaq, renderFaqBlock } from "@/lib/ai-faq-select"
import { pageHelpContent } from "./page-help-content"
import {
  SEGMENT_LABELS,
  computeSegment,
  effectiveSegment,
  monthsSince,
  parseSegmentationConfig,
  type ClientSegmentKey,
} from "./segmentation"
import type { Role } from "@prisma/client"
import { resolveBranchScope } from "./session"
import { taskVisibilityWhere } from "./tasks/task-visibility"
import { expenseAmountInWindow, expenseFetchWindow } from "./expense-amortization"
import { hasPermission, type RolePermissions } from "./permissions"

// ─── Утилиты ───────────────────────────────────────────────────────────

const fmt = (n: number): string =>
  new Intl.NumberFormat("ru-RU").format(Math.round(n))

interface MonthRange {
  start: Date
  end: Date
  name: string
  year: number
  month: number // 1..12
}

function monthOf(year: number, month: number): MonthRange {
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0, 23, 59, 59, 999)
  const name = start.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
  return { start, end, name, year, month }
}

function build4Months(now: Date): MonthRange[] {
  const months: MonthRange[] = []
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(monthOf(d.getFullYear(), d.getMonth() + 1))
  }
  return months
}

const RU_MONTHS: Record<string, number> = {
  январь: 1, января: 1, январе: 1, январей: 1,
  февраль: 2, февраля: 2, феврале: 2,
  март: 3, марта: 3, марте: 3,
  апрель: 4, апреля: 4, апреле: 4,
  май: 5, мая: 5, мае: 5,
  июнь: 6, июня: 6, июне: 6,
  июль: 7, июля: 7, июле: 7,
  август: 8, августа: 8, августе: 8,
  сентябрь: 9, сентября: 9, сентябре: 9,
  октябрь: 10, октября: 10, октябре: 10,
  ноябрь: 11, ноября: 11, ноябре: 11,
  декабрь: 12, декабря: 12, декабре: 12,
}

// Стоп-слова для детектора сущностей: короткие/служебные русские слова,
// которые часто встречаются в вопросах и дают много ложных матчей при ILIKE.
const STOPWORDS = new Set([
  "сколько", "какой", "какая", "какое", "какие", "кому", "когда", "почему",
  "зачем", "куда", "откуда", "наш", "наша", "наше", "наши", "мой", "моя", "моё", "мои",
  "мне", "нам", "нас", "там", "тут", "этом", "этой", "этих", "тогда", "сейчас",
  "был", "была", "было", "были", "есть", "будет", "будут", "стало", "стали",
  "должен", "должна", "должно", "нужно", "нужен", "нужна", "надо", "можно", "нельзя",
  "хочу", "хочет", "хочется", "хотел", "хотела", "хотим", "хотят",
  "делать", "сделать", "делает", "делают",
  "если", "иначе", "тогда", "потому", "значит", "итак", "потом", "далее",
  "тоже", "также", "только", "ещё", "уже", "более", "менее", "много", "мало",
  "сегодня", "вчера", "завтра", "месяц", "месяце", "месяца", "год", "году", "года",
  "день", "дни", "дня", "неделя", "недели", "неделю",
  "клиент", "клиента", "клиенты", "клиентов", "клиенте", "клиентом",
  "группа", "группе", "группу", "группы", "группой",
  "педагог", "педагога", "педагоги", "педагогов", "педагогу",
  "инструктор", "инструктора", "инструкторы", "инструкторов",
  "сотрудник", "сотрудника", "сотрудники",
  "филиал", "филиала", "филиале", "филиалы",
  "ставка", "ставку", "ставки", "ставке",
  "оплата", "оплате", "оплаты", "оплат",
  "выручка", "выручки", "выручке",
  "расход", "расхода", "расходы", "расходов",
  "абонемент", "абонемента", "абонементы", "абонементов",
])

function tokenize(message: string): string[] {
  // Извлекаем русские/латинские слова длиной ≥4, без цифр и пунктуации.
  const raw = message.toLowerCase().match(/[a-zа-яё]{4,}/gi) || []
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of raw) {
    const lw = w.toLowerCase()
    if (STOPWORDS.has(lw)) continue
    if (RU_MONTHS[lw]) continue // месяцы обрабатываются отдельно
    if (seen.has(lw)) continue
    seen.add(lw)
    out.push(lw)
  }
  return out
}

function detectMonth(message: string, now: Date): MonthRange | null {
  const low = message.toLowerCase()
  for (const [word, m] of Object.entries(RU_MONTHS)) {
    if (new RegExp(`\\b${word}\\b`).test(low)) {
      // Год по умолчанию: текущий, но если месяц > текущего — берём прошлый год.
      const y = m > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear()
      return monthOf(y, m)
    }
  }
  return null
}

// ─── 1. КАРТА НАВИГАЦИИ ────────────────────────────────────────────────

// Левое меню приложения. ДЕРЖАТЬ В СИНХРОНЕ с app-sidebar.tsx (navItems/crmItems/
// financeItems/otherItems). Группы соответствуют SidebarGroupLabel.
const LEFT_MENU: { group: string | null; items: { label: string; path: string }[] }[] = [
  { group: null, items: [{ label: "Дашборд", path: "/" }] },
  {
    group: "CRM",
    items: [
      { label: "Клиенты", path: "/crm/contacts" },
      { label: "Продажи", path: "/crm/sales" },
      { label: "Дети", path: "/crm/children" },
      { label: "Абонементы", path: "/crm/subscriptions" },
      { label: "Обзвон", path: "/crm/calls" },
    ],
  },
  {
    group: "Финансы",
    items: [
      { label: "Касса", path: "/finance/cash" },
      { label: "Оплаты", path: "/finance/payments" },
      { label: "Расходы", path: "/finance/expenses" },
      { label: "ДДС", path: "/finance/dds" },
      { label: "Должники", path: "/finance/debtors" },
    ],
  },
  {
    group: "Основное меню",
    items: [
      { label: "Расписание", path: "/schedule" },
      { label: "Занятия", path: "/lessons" },
      { label: "Зарплата", path: "/salary" },
      { label: "Склад", path: "/stock" },
      { label: "Задачи", path: "/tasks" },
      { label: "Отчёты", path: "/reports" },
      { label: "Настройки", path: "/settings" },
      { label: "Справка", path: "/help" },
    ],
  },
]

// Хаб «Настройки» — две вкладки с плитками-ссылками. ДЕРЖАТЬ В СИНХРОНЕ с
// settings/page.tsx (orgTiles / personalTiles). Несколько плиток ведут на страницы
// вне раздела настроек (Сотрудники, Касса, Плановые расходы, Подписка).
const SETTINGS_HUB: { tab: string; items: { label: string; path: string }[] }[] = [
  {
    tab: "Организация",
    items: [
      { label: "Информация об организации", path: "/settings/organization" },
      { label: "Филиалы", path: "/settings/branches" },
      { label: "Направления", path: "/settings/directions" },
      { label: "Права ролей", path: "/settings/role-permissions" },
      { label: "Производственный календарь", path: "/settings/production-calendar" },
      { label: "Автотриггеры задач", path: "/settings/tasks" },
      { label: "Абонементы (модель + автозакрытие)", path: "/settings/subscription-model" },
    ],
  },
  {
    tab: "Персональные",
    items: [
      { label: "Бонусы админов", path: "/settings/admin-bonus" },
      { label: "Причины отчисления", path: "/settings/withdrawal-reasons" },
      { label: "Статьи доходов и расходов", path: "/settings/finance-categories" },
      { label: "Сотрудники", path: "/staff" },
      { label: "Касса", path: "/finance/cash" },
      { label: "Причины пропусков", path: "/settings/absence-reasons" },
      { label: "Виды посещений", path: "/settings/attendance-matrix" },
      { label: "Каналы привлечения", path: "/settings/channels" },
      { label: "Шаблоны скидок", path: "/settings/discount-templates" },
      { label: "Сегментация клиентов", path: "/settings/segmentation" },
      { label: "Импорт базы", path: "/settings/leads-import" },
      { label: "Плановые расходы", path: "/finance/planned-expenses" },
      { label: "Интеграции", path: "/settings/integrations" },
      { label: "Подписка", path: "/billing" },
    ],
  },
]

// Запасной ориентир по первому сегменту пути — для вложенных страниц, которых нет
// напрямую в меню (открываются изнутри своего раздела).
const SEGMENT_HINT: Record<string, string> = {
  crm: "левое меню, блок «CRM»",
  finance: "левое меню, блок «Финансы»",
  reports: "левое меню → «Отчёты» (там список всех отчётов)",
  schedule: "левое меню → «Расписание»",
  lessons: "левое меню → «Занятия»",
  salary: "левое меню → «Зарплата»",
  staff: "левое меню → «Настройки» → вкладка «Персональные» → «Сотрудники»",
  tasks: "левое меню → «Задачи»",
  settings: "левое меню → «Настройки»",
}

/** Совпадение по границе сегмента: "/finance" — префикс "/finance/cash", но не "/financex". */
function isPathPrefix(prefix: string, path: string): boolean {
  if (prefix === "/") return path === "/"
  return path === prefix || path.startsWith(prefix + "/")
}

/**
 * Человеческое описание, КАК добраться до страницы — словами, через названия
 * пунктов меню, без технических URL. Порядок: точный пункт левого меню → плитка
 * «Настроек» → ближайший родитель в левом меню → подсказка по первому сегменту.
 */
function locatePage(path: string): string {
  // 1. Точный пункт левого меню.
  for (const grp of LEFT_MENU) {
    for (const it of grp.items) {
      if (it.path === path) {
        if (grp.group === null) return `левое меню → «${it.label}»`
        if (grp.group === "Основное меню") return `левое меню → «${it.label}»`
        return `левое меню → блок «${grp.group}» → «${it.label}»`
      }
    }
  }
  // 2. Точная плитка в хабе «Настройки».
  for (const tab of SETTINGS_HUB) {
    for (const it of tab.items) {
      if (it.path === path) {
        return `левое меню → «Настройки» → вкладка «${tab.tab}» → плитка «${it.label}»`
      }
    }
  }
  // 3. Ближайший родитель в левом меню (страница открывается изнутри раздела).
  let best: { label: string; group: string | null; path: string } | null = null
  for (const grp of LEFT_MENU) {
    for (const it of grp.items) {
      if (it.path !== "/" && isPathPrefix(it.path, path)) {
        if (!best || it.path.length > best.path.length) best = { label: it.label, group: grp.group, path: it.path }
      }
    }
  }
  if (best) {
    const where =
      best.group && best.group !== "Основное меню"
        ? `левое меню → блок «${best.group}» → «${best.label}»`
        : `левое меню → «${best.label}»`
    return `${where} (внутренний раздел)`
  }
  // 4. Подсказка по первому сегменту.
  const seg = path.replace(/^\//, "").split("/")[0]
  return SEGMENT_HINT[seg] || "откройте через соответствующий раздел левого меню"
}

export function buildNavMap(): string {
  const menuLines: string[] = ["СТРУКТУРА ЛЕВОГО МЕНЮ (одинаково на каждом экране, слева):"]
  for (const grp of LEFT_MENU) {
    const items = grp.items.map(i => i.label).join(" · ")
    if (grp.group === null) menuLines.push(`• ${items}`)
    else if (grp.group === "Основное меню") menuLines.push(`Ниже разделителя: ${items}`)
    else menuLines.push(`Блок «${grp.group}»: ${items}`)
  }

  const settingsLines: string[] = ["РАЗДЕЛ «НАСТРОЙКИ» (открыть из левого меню; две вкладки с плитками):"]
  for (const tab of SETTINGS_HUB) {
    settingsLines.push(`Вкладка «${tab.tab}»: ${tab.items.map(i => i.label).join(" · ")}`)
  }

  const pageLines: string[] = ["СТРАНИЦЫ (для каждой — где открыть и что внутри):"]
  for (const [key, content] of Object.entries(pageHelpContent)) {
    const path = key === "dashboard" ? "/" : `/${key}`
    pageLines.push(`- «${content.title}» — где: ${locatePage(path)} — ${content.subtitle}`)
  }

  // FAQ «спрятанных действий» переехал в таблицу ai_faq (31.08.2026): один
  // источник правды, правится без деплоя и отбирается под вопрос
  // (lib/ai-faq-select.ts). Здесь остаётся только карта — она генерится из
  // LEFT_MENU / SETTINGS_HUB / pageHelpContent и протухнуть не может.

  return `КАРТА НАВИГАЦИИ CRM:\n${menuLines.join("\n")}\n\n${settingsLines.join("\n")}\n\n${pageLines.join("\n")}`
}

// ─── 1.5. БАЗА ЗНАНИЙ (ai_faq) ─────────────────────────────────────────
//
// Единственный источник фактов о системе: с 31.08.2026 сюда переехал и FAQ,
// который раньше жил в коде. Правится через /admin/ai-faq без деплоя.
//
// В промпт идут НЕ все записи: ядро (isCore) — всегда, остальное отбирается по
// теме вопроса (lib/ai-faq-select.ts). До этого в промпт шло всё разом, и вместе
// с кодовым FAQ статика доходила до ~50k токенов — модель хуже держала правила, а
// дубли давали ей выбор между двумя формулировками одного факта.
//
// Ядро кладём в СТАТИЧЕСКУЮ (кэшируемую) часть промпта: оно одинаково для всех
// запросов. Подборку — в динамическую, она своя на каждый вопрос.
export interface FaqSlices {
  /** Правила, действующие всегда. Кэшируемая часть промпта. */
  core: string
  /** Записи под тему вопроса. Некэшируемая часть промпта. */
  matched: string
}

export async function buildFaqSlices(message: string): Promise<FaqSlices> {
  // Блок необязательный: любой сбой чтения (в т.ч. ещё не применённая миграция
  // на свежем окружении) не должен ронять ответ ассистента — вернём пустые куски.
  try {
    const items = await db.aiFaq.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { question: true, answer: true, keywords: true, isCore: true },
    })
    const { core, matched } = selectFaq(items, message)
    return {
      core: renderFaqBlock(core, "core"),
      matched: renderFaqBlock(matched, "matched"),
    }
  } catch (err) {
    console.error("[ai-context] buildFaqSlices error:", err)
    return { core: "", matched: "" }
  }
}

// ─── 2. БАЗОВЫЙ СРЕЗ (Level 1) ─────────────────────────────────────────

export async function buildBaseContext(
  tenantId: string,
  role: string,
  employeeId?: string | null,
  allowedBranchIds?: string[] | null,
): Promise<string> {
  const now = new Date()
  const months = build4Months(now)
  const current = months[months.length - 1]
  const periodStart = months[0].start
  const periodEnd = months[months.length - 1].end
  // Окно выборки расходов для ОПИУ (финрез): расширяем на ±60 мес по дате платежа, т.к.
  // месяц признания (recognitionMode) может отличаться от даты платежа в обе стороны.
  // Точную долю за месяц даёт expenseAmountInWindow — как в отчёте P&L.
  const expWindow = expenseFetchWindow(months[0].year, months[0].month, current.year, current.month)

  // Скоуп задач по роли + филиалу (та же логика, что на странице «Задачи» и
  // дашборде): управленцы видят все задачи тенанта, инструктор/«только чтение» —
  // только назначенные лично; админ с привязкой к филиалу — только свои филиалы.
  // Применяется и к счётчику, и к перечню — чтобы ИИ не раскрывал чужие задачи.
  // resolveBranchScope (async) считает coversAllBranches — админ со всеми
  // филиалами видит и задачи о безфилиальных клиентах (как на дашборде/странице).
  const taskScope = await resolveBranchScope(tenantId, allowedBranchIds)
  const taskWhere = {
    tenantId,
    deletedAt: null,
    completedAt: null,
    ...taskVisibilityWhere(role as Role, employeeId ?? null, taskScope),
  }

  const [
    org,
    branches,
    directions,
    employees,
    clientCount,
    leadCount,
    activeSubsCount,
    newLeadsMonth,
    firstPaymentsMonth,
    churnedMonth,
    revenueAttendances,
    expensesPeriod,
    monthExpenseTop,
    tasksOpen,
    tasksList,
    debtors,
    groups,
    monthSubsForAvg,
  ] = await Promise.all([
    db.organization.findUnique({
      where: { id: tenantId },
      select: { name: true, rolePermissions: true },
    }),
    db.branch.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    }),
    db.direction.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    }),
    db.employee.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, firstName: true, lastName: true, role: true },
    }),
    db.client.count({
      where: { tenantId, deletedAt: null, clientStatus: { not: null } },
    }),
    db.client.count({
      where: {
        tenantId, deletedAt: null,
        clientStatus: null,
        funnelStatus: { not: "active_client" },
      },
    }),
    db.subscription.count({
      where: { tenantId, deletedAt: null, status: "active" },
    }),
    // Новые лиды за текущий месяц
    db.client.count({
      where: {
        tenantId, deletedAt: null,
        createdAt: { gte: current.start, lte: current.end },
        clientStatus: null,
      },
    }),
    // Первые оплаты за текущий месяц (конверсия)
    db.client.count({
      where: {
        tenantId, deletedAt: null,
        firstPaymentDate: { gte: current.start, lte: current.end },
      },
    }),
    // Отток за текущий месяц
    db.subscription.findMany({
      where: {
        tenantId, deletedAt: null,
        withdrawalDate: { gte: current.start, lte: current.end },
      },
      select: {
        withdrawalReason: { select: { name: true } },
      },
    }),
    // Выручка за весь период — с разбивкой по инструктору/направлению
    db.attendance.findMany({
      where: {
        tenantId,
        lesson: { date: { gte: periodStart, lte: periodEnd } },
        attendanceType: { countsAsRevenue: true },
      },
      select: {
        chargeAmount: true,
        instructorPayAmount: true,
        lesson: { select: { date: true, instructorId: true, groupId: true } },
        subscription: { select: { directionId: true } },
      },
    }),
    // Расходы за весь период (финрез: «Не учитывать в финрезе» исключаем —
    // они не участвуют в прибыли/марже).
    db.expense.findMany({
      where: { tenantId, deletedAt: null, date: { gte: expWindow.gte, lte: expWindow.lte }, recognitionMode: { not: "not_in_pnl" } },
      select: {
        amount: true, date: true, comment: true,
        recognitionMode: true, amortizationMonths: true, amortizationStartDate: true,
        category: { select: { name: true } },
        branches: { select: { branchId: true, directionId: true } },
      },
    }),
    // Топ-5 крупных расходов текущего месяца (без «Не учитывать в финрезе»).
    db.expense.findMany({
      where: {
        tenantId, deletedAt: null,
        date: { gte: current.start, lte: current.end },
        recognitionMode: { not: "not_in_pnl" },
      },
      orderBy: { amount: "desc" },
      take: 5,
      select: {
        amount: true,
        comment: true,
        category: { select: { name: true } },
        branches: { select: { branch: { select: { name: true } } } },
      },
    }),
    db.task.count({ where: taskWhere }),
    // Перечень открытых задач (тот же скоуп, что у счётчика) — чтобы ИИ мог
    // ответить «какие задачи открыты», не раскрывая чужие ограниченным ролям.
    db.task.findMany({
      where: taskWhere,
      orderBy: [{ dueDate: "asc" }],
      take: 15,
      select: {
        title: true, dueDate: true, autoTrigger: true,
        assignee: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true } },
      },
    }),
    // Долг по абонементу = balance > 0 (сколько осталось оплатить), не < 0
    db.subscription.findMany({
      where: { tenantId, deletedAt: null, status: "active", balance: { gt: 0 } },
      select: { balance: true, client: { select: { firstName: true, lastName: true } } },
    }),
    db.group.findMany({
      where: { tenantId, deletedAt: null, isOneTime: false },
      select: {
        id: true, name: true, maxStudents: true, branchId: true, directionId: true,
        instructor: { select: { firstName: true, lastName: true } },
        branch: { select: { name: true } },
        direction: { select: { name: true } },
        _count: { select: { enrollments: { where: { isActive: true } } } },
      },
    }),
    // Абонементы текущего месяца — для среднего чека
    db.subscription.findMany({
      where: {
        tenantId, deletedAt: null,
        periodYear: current.year, periodMonth: current.month,
        status: { in: ["active", "closed"] },
      },
      select: { finalAmount: true },
    }),
  ])

  const employeeById = new Map(employees.map(e => [e.id, e]))
  const branchById = new Map(branches.map(b => [b.id, b.name]))
  const directionById = new Map(directions.map(d => [d.id, d.name]))
  const groupById = new Map(groups.map(g => [g.id, g]))

  // Финансовые показатели (выручка/расходы/прибыль/средний чек/должники/крупные
  // расходы) кладём в контекст ТОЛЬКО ролям с правом на финрез (finance.result —
  // как виджеты финансов на дашборде/ДДС). Иначе «Инструктор» и «только чтение»
  // видели бы выручку и прибыль организации в ответах ИИ. Данные всё равно
  // выбираются (для владельца/управляющего), но в промпт для незапривилегированной
  // роли не попадают.
  const orgPerms = (org?.rolePermissions as RolePermissions | null) ?? null
  // Финрез (выручка/прибыль/средний чек/топ инструкторов/P&L направлений) — право
  // finance.result (как виджеты финрез на дашборде; админ по умолчанию его не имеет).
  const canSeeFinance = hasPermission(role as Role, "finance.result", orgPerms)
  // Долги и расходы (оплаты/расходы/должники) — право finance.view; оно есть и у
  // администратора, поэтому эти блоки гейтим отдельно, чтобы не прятать их от админа.
  const canSeeFinanceOps = hasPermission(role as Role, "finance.view", orgPerms)

  let ctx = `Организация: ${org?.name || "—"}
Дата: ${now.toLocaleDateString("ru-RU", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })} (день недели указан — используй его, НЕ вычисляй сам; «завтра» = следующий календарный день)
Филиалов: ${branches.length}${branches.length ? " (" + branches.map(b => b.name).join(", ") + ")" : ""}
Направлений: ${directions.length}${directions.length ? " (" + directions.map(d => d.name).join(", ") + ")" : ""}
Активных сотрудников: ${employees.length}
Клиентов: ${clientCount} | Лидов: ${leadCount} | Активных абонементов: ${activeSubsCount} | Открытых задач: ${tasksOpen}
`

  // ─── Открытые задачи (перечень) ───
  // Показываем содержимое задач, только если пользователь спросит про задачи
  // (модель проинструктирована не упоминать их без запроса). Уже с учётом скоупа.
  if (tasksList.length > 0) {
    const shown = tasksOpen > tasksList.length ? `, показаны первые ${tasksList.length}` : ""
    ctx += `\n=== ОТКРЫТЫЕ ЗАДАЧИ (${tasksOpen}${shown}) ===\n`
    for (const t of tasksList) {
      const due = new Date(t.dueDate).toLocaleDateString("ru-RU")
      const who = t.assignee
        ? [t.assignee.lastName, t.assignee.firstName].filter(Boolean).join(" ").trim() || "—"
        : "—"
      const client = t.client
        ? [t.client.lastName, t.client.firstName].filter(Boolean).join(" ").trim()
        : null
      ctx += `• ${due} — ${t.title}${client ? ` (клиент: ${client})` : ""} · исполнитель: ${who}${t.autoTrigger ? " · авто" : ""}\n`
    }
  }

  // ─── Помесячная разбивка (только для ролей с доступом к финрезу) ───
  if (canSeeFinance) {
    ctx += `\n=== ВЫРУЧКА / РАСХОДЫ / ПРИБЫЛЬ ПО МЕСЯЦАМ ===\n`
    for (const m of months) {
      const mRevenue = revenueAttendances
        .filter(a => {
          const d = new Date(a.lesson.date)
          return d >= m.start && d <= m.end
        })
        .reduce((s, a) => s + Number(a.chargeAmount), 0)

      // ОПИУ: расход относим к месяцу ПРИЗНАНИЯ (recognitionMode), не к дате платежа.
      const mExpenses = expensesPeriod
        .reduce((s, e) => s + expenseAmountInWindow(e, m.year, m.month, m.year, m.month), 0)

      const profit = mRevenue - mExpenses
      ctx += `${m.name}: выручка ${fmt(mRevenue)} ₽ | расходы ${fmt(mExpenses)} ₽ | прибыль ${fmt(profit)} ₽\n`
    }
  } else {
    ctx += `\n(Финансовый результат — выручка, прибыль, средний чек, P&L по направлениям — этой роли НЕ передан. На вопросы о выручке/прибыли организации отвечай, что финрез (P&L) доступен владельцу и управляющему.)\n`
  }

  // ─── Срез по текущему месяцу ───
  const monthAtt = revenueAttendances.filter(a => {
    const d = new Date(a.lesson.date)
    return d >= current.start && d <= current.end
  })

  ctx += `\n=== ${current.name.toUpperCase()} — ДЕТАЛИ ===\n`

  // Средний чек (финрез — только для ролей с finance.result)
  if (canSeeFinance && monthSubsForAvg.length > 0) {
    const totalFinal = monthSubsForAvg.reduce((s, x) => s + Number(x.finalAmount), 0)
    const avg = totalFinal / monthSubsForAvg.length
    ctx += `Средний чек абонемента: ${fmt(avg)} ₽ (по ${monthSubsForAvg.length} абонементам)\n`
  }

  // Новые лиды и конверсия
  ctx += `Новых лидов: ${newLeadsMonth} | Первых оплат: ${firstPaymentsMonth}\n`

  // Отток
  if (churnedMonth.length > 0) {
    const reasons = new Map<string, number>()
    for (const c of churnedMonth) {
      const r = c.withdrawalReason?.name || "без указания причины"
      reasons.set(r, (reasons.get(r) || 0) + 1)
    }
    const top = Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
    ctx += `Отток: ${churnedMonth.length} абонементов (${top.map(([r, n]) => `${r}: ${n}`).join(", ")})\n`
  } else {
    ctx += `Отток: 0\n`
  }

  // ─── Топ-5 инструкторов по выручке текущего месяца ───
  const byInstructor = new Map<string, { revenue: number; lessons: Set<string>; pay: number }>()
  for (const a of monthAtt) {
    const id = a.lesson.instructorId
    if (!byInstructor.has(id)) byInstructor.set(id, { revenue: 0, lessons: new Set(), pay: 0 })
    const x = byInstructor.get(id)!
    x.revenue += Number(a.chargeAmount)
    x.pay += Number(a.instructorPayAmount)
    x.lessons.add(a.lesson.groupId + ":" + new Date(a.lesson.date).toISOString().slice(0, 10))
  }
  const topInstructors = Array.from(byInstructor.entries())
    .map(([id, v]) => ({
      id,
      name: (() => {
        const e = employeeById.get(id)
        return e ? `${e.lastName} ${e.firstName}` : "Неизвестный"
      })(),
      revenue: v.revenue,
      lessons: v.lessons.size,
      pay: v.pay,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  if (canSeeFinance && topInstructors.length > 0) {
    ctx += `\nТоп инструкторов по выручке за ${current.name}:\n`
    for (const t of topInstructors) {
      ctx += `  - ${t.name}: выручка ${fmt(t.revenue)} ₽ | занятий: ${t.lessons} | начислено ЗП: ${fmt(t.pay)} ₽\n`
    }
  }

  // ─── P&L по направлениям за текущий месяц ───
  const directionPL = new Map<string, { revenue: number; expenses: number }>()
  for (const d of directions) directionPL.set(d.id, { revenue: 0, expenses: 0 })

  for (const a of monthAtt) {
    const dirId = a.subscription?.directionId || groupById.get(a.lesson.groupId)?.directionId
    if (!dirId) continue
    if (!directionPL.has(dirId)) directionPL.set(dirId, { revenue: 0, expenses: 0 })
    directionPL.get(dirId)!.revenue += Number(a.chargeAmount)
  }

  for (const e of expensesPeriod) {
    // ОПИУ: берём долю, признанную в текущем месяце (а не сырую сумму платежа).
    const recognized = expenseAmountInWindow(e, current.year, current.month, current.year, current.month)
    if (recognized === 0) continue
    // Прямое отнесение по directionId в expenseBranches
    const linkedDirs = e.branches.filter(b => b.directionId).map(b => b.directionId!)
    if (linkedDirs.length > 0) {
      const share = recognized / linkedDirs.length
      for (const dirId of linkedDirs) {
        if (!directionPL.has(dirId)) directionPL.set(dirId, { revenue: 0, expenses: 0 })
        directionPL.get(dirId)!.expenses += share
      }
    }
  }

  const dirRows = Array.from(directionPL.entries())
    .map(([id, v]) => ({
      name: directionById.get(id) || "Без направления",
      revenue: v.revenue,
      expenses: v.expenses,
      margin: v.revenue - v.expenses,
    }))
    .filter(r => r.revenue > 0 || r.expenses > 0)
    .sort((a, b) => b.revenue - a.revenue)

  if (canSeeFinance && dirRows.length > 0) {
    ctx += `\nP&L по направлениям за ${current.name} (только прямые расходы):\n`
    for (const r of dirRows) {
      ctx += `  - ${r.name}: выручка ${fmt(r.revenue)} ₽ | прямые расходы ${fmt(r.expenses)} ₽ | маржа ${fmt(r.margin)} ₽\n`
    }
  }

  // ─── Заполняемость по филиалам ───
  const branchFill = new Map<string, { sum: number; count: number; groups: number }>()
  for (const g of groups) {
    const fill = g.maxStudents ? (g._count.enrollments / g.maxStudents) * 100 : 0
    const key = g.branchId
    if (!branchFill.has(key)) branchFill.set(key, { sum: 0, count: 0, groups: 0 })
    const x = branchFill.get(key)!
    x.sum += fill
    x.count += g.maxStudents ? 1 : 0
    x.groups += 1
  }
  if (branchFill.size > 0) {
    ctx += `\nЗаполняемость по филиалам (средняя по группам):\n`
    for (const [bid, v] of branchFill.entries()) {
      const avg = v.count > 0 ? v.sum / v.count : 0
      ctx += `  - ${branchById.get(bid) || "—"}: ${Math.round(avg)}% (${v.groups} групп)\n`
    }
  }

  // ─── Топ-5 крупных расходов (право finance.view — есть и у админа) ───
  if (canSeeFinanceOps && monthExpenseTop.length > 0) {
    ctx += `\nКрупные расходы за ${current.name}:\n`
    for (const e of monthExpenseTop) {
      const cat = e.category?.name || "—"
      const br = e.branches.map(b => b.branch?.name).filter(Boolean).join(", ")
      ctx += `  - ${cat}${br ? " (" + br + ")" : ""}: ${fmt(Number(e.amount))} ₽${e.comment ? " — " + e.comment : ""}\n`
    }
  }

  // ─── Должники и группы (должники — право finance.view, есть и у админа) ───
  if (canSeeFinanceOps && debtors.length > 0) {
    const totalDebt = debtors.reduce((s, d) => s + Math.abs(Number(d.balance)), 0)
    ctx += `\nДолжники: ${debtors.length} клиентов на ${fmt(totalDebt)} ₽\n`
    debtors.slice(0, 5).forEach(d => {
      ctx += `  - ${d.client.lastName} ${d.client.firstName}: ${fmt(Math.abs(Number(d.balance)))} ₽\n`
    })
  }

  if (groups.length > 0) {
    ctx += `\nГруппы (${groups.length} всего, показано первые 20):\n`
    groups.slice(0, 20).forEach(g => {
      const fill = g.maxStudents ? Math.round((g._count.enrollments / g.maxStudents) * 100) : 0
      const instr = g.instructor ? `${g.instructor.lastName} ${g.instructor.firstName}` : "—"
      ctx += `  - ${g.name} (${g.direction?.name || "—"}, ${g.branch?.name || "—"}, инструктор: ${instr}): ${g._count.enrollments}/${g.maxStudents || "?"} (${fill}%)\n`
    })
  }

  return ctx
}

// ─── 3. ДИНАМИЧЕСКИЙ СРЕЗ (Level 2) ───────────────────────────────────

interface FoundClient {
  id: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  clientStatus: string | null
  funnelStatus: string
  segment: string
  clientBalance: number
  branchName: string | null
  assigneeName: string | null
}

interface FoundGroup {
  id: string
  name: string
  branchName: string
  directionName: string
  instructorName: string
  maxStudents: number
  enrollmentsCount: number
}

interface FoundEmployee {
  id: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
}

export async function buildDynamicSlice(message: string, tenantId: string): Promise<string> {
  const now = new Date()
  const tokens = tokenize(message)
  const detectedMonth = detectMonth(message, now)

  // Фрагмент телефона из вопроса (последние до 10 цифр) — чтобы находить клиента
  // по номеру, а не только по ФИО (частый кейс «найди клиента по телефону …»).
  const rawDigits = (message.match(/\d/g) || []).join("")
  const phoneFrag = rawDigits.length >= 6 ? rawDigits.slice(-10) : null
  // Вопрос про конкретного человека — есть значащие имя-токены или телефон.
  const personLookup = tokens.length > 0 || phoneFrag !== null

  // Без токенов, без телефона и без месяца — слайс пустой.
  if (!personLookup && !detectedMonth) return ""

  // Параллельный поиск по сущностям.
  const tokenFilters = tokens.length > 0
    ? tokens.map(t => ({ contains: t, mode: "insensitive" as const }))
    : []

  const [clients, groups, employees] = await Promise.all([
    personLookup
      ? db.client.findMany({
          where: {
            tenantId, deletedAt: null,
            OR: [
              ...tokenFilters.map(f => ({ firstName: f })),
              ...tokenFilters.map(f => ({ lastName: f })),
              // Матч по имени/фамилии подопечного (ребёнка), а не только родителя.
              ...tokenFilters.map(f => ({ wards: { some: { firstName: f } } })),
              ...tokenFilters.map(f => ({ wards: { some: { lastName: f } } })),
              // Матч по телефону (последние до 10 цифр из вопроса).
              ...(phoneFrag ? [{ phone: { contains: phoneFrag } }] : []),
            ],
          },
          select: {
            id: true, firstName: true, lastName: true, phone: true,
            clientStatus: true, funnelStatus: true, segmentOverride: true,
            firstPaymentDate: true, clientBalance: true,
            branch: { select: { name: true } },
            assignee: { select: { firstName: true, lastName: true } },
          },
          take: 6,
        })
      : Promise.resolve([]),
    tokens.length > 0
      ? db.group.findMany({
          where: {
            tenantId, deletedAt: null, isOneTime: false,
            OR: tokenFilters.map(f => ({ name: f })),
          },
          select: {
            id: true, name: true, maxStudents: true,
            branch: { select: { name: true } },
            direction: { select: { name: true } },
            instructor: { select: { firstName: true, lastName: true } },
            _count: { select: { enrollments: { where: { isActive: true } } } },
          },
          take: 3,
        })
      : Promise.resolve([]),
    tokens.length > 0
      ? db.employee.findMany({
          where: {
            tenantId, deletedAt: null,
            OR: [
              ...tokenFilters.map(f => ({ firstName: f })),
              ...tokenFilters.map(f => ({ lastName: f })),
            ],
          },
          select: {
            id: true, firstName: true, lastName: true, role: true, isActive: true,
          },
          take: 3,
        })
      : Promise.resolve([]),
  ])

  // Ничего не нашли — пустой слайс (детектор месяца обработается ниже).
  if (clients.length === 0 && groups.length === 0 && employees.length === 0 && !detectedMonth) {
    // Но если это был поиск по человеку (имя/телефон) — вернём ЯВНУЮ оговорку,
    // чтобы модель не заявляла «клиента нет» и не советовала создавать дубль:
    // срез контекста частичный, всю базу видит только страница «Клиенты».
    if (personLookup) {
      return "ПОИСК ПО ВОПРОСУ: по упомянутому имени/телефону в срезе контекста совпадений не найдено. ВАЖНО: срез контекста ограничен и НЕ отражает всю базу — это НЕ доказательство, что клиента (или сотрудника) нет. НЕ утверждай, что человека не существует, и НЕ предлагай заводить нового клиента (риск дубля). Попроси открыть «Клиенты» (строка поиска ищет и по ФИО, и по цифрам телефона) или «Дети» и найти вручную.\n"
    }
    return ""
  }

  let out = "ДЕТАЛИ ПО УПОМЯНУТЫМ В ВОПРОСЕ СУЩНОСТЯМ:\n"

  // ─── Клиенты ───
  if (clients.length > 0) {
    out += `\nНайденные клиенты (${clients.length}; показаны совпавшие в срезе — список частичный, если нужного нет, ищи на странице «Клиенты»):\n`
    // Сегмент клиента — тот же эффективный сегмент, что в карточке/отчёте/табе
    // «Активные» (баг #26): ручное переопределение ?? авто-расчёт по настройкам.
    // Считаем для ≤3 клиентов: конфиг организации + Σ chargedAmount (режим «сумма»).
    const orgSeg = await db.organization.findUnique({
      where: { id: tenantId },
      select: { segmentationConfig: true },
    })
    const segConfig = parseSegmentationConfig(orgSeg?.segmentationConfig)
    const chargedByClient = new Map<string, number>()
    if (segConfig?.mode === "amount") {
      const activeIds = clients.filter(c => c.clientStatus === "active").map(c => c.id)
      if (activeIds.length > 0) {
        const sums = await db.subscription.groupBy({
          by: ["clientId"],
          where: { tenantId, clientId: { in: activeIds }, deletedAt: null },
          _sum: { chargedAmount: true },
        })
        for (const s of sums) chargedByClient.set(s.clientId, Number(s._sum.chargedAmount ?? 0))
      }
    }
    for (const c of clients) {
      const data = await loadClientDetails(c.id, tenantId)
      // Сегмент показываем только для активных клиентов (как в UI); иначе «—».
      let segmentLabel = "—"
      if (c.clientStatus === "active") {
        const metric = segConfig
          ? segConfig.mode === "amount"
            ? chargedByClient.get(c.id) ?? 0
            : monthsSince(c.firstPaymentDate)
          : 0
        const computed: ClientSegmentKey = segConfig ? computeSegment(metric, segConfig) : "new_client"
        const key = effectiveSegment(c.segmentOverride as ClientSegmentKey | null, computed)
        segmentLabel = SEGMENT_LABELS[key]
      }
      out += formatClientDetails(c, data, segmentLabel)
    }
  }

  // ─── Группы ───
  if (groups.length > 0) {
    out += `\nНайденные группы (${groups.length}):\n`
    for (const g of groups) {
      const data = await loadGroupDetails(g.id, tenantId, now)
      out += formatGroupDetails(g, data)
    }
  }

  // ─── Сотрудники ───
  if (employees.length > 0) {
    out += `\nНайденные сотрудники (${employees.length}):\n`
    for (const e of employees) {
      const data = await loadEmployeeDetails(e.id, tenantId, now)
      out += formatEmployeeDetails(e, data)
    }
  }

  // ─── Месяц ───
  if (detectedMonth) {
    out += `\n` + await buildMonthSlice(detectedMonth, tenantId)
  }

  return out
}

// --- Клиент: подробности ---

async function loadClientDetails(clientId: string, tenantId: string) {
  const [subs, payments, attendancesCount, wards] = await Promise.all([
    db.subscription.findMany({
      where: { tenantId, clientId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        status: true, periodYear: true, periodMonth: true,
        finalAmount: true, balance: true,
        direction: { select: { name: true } },
        group: { select: { name: true } },
      },
    }),
    db.payment.findMany({
      where: { tenantId, clientId, deletedAt: null },
      orderBy: { date: "desc" },
      take: 3,
      select: { amount: true, date: true, method: true, type: true },
    }),
    db.attendance.count({
      where: { tenantId, clientId, attendanceType: { countsAsRevenue: true } },
    }),
    db.ward.findMany({
      where: { tenantId, clientId },
      select: { firstName: true, lastName: true, birthDate: true },
      take: 5,
    }),
  ])
  return { subs, payments, attendancesCount, wards }
}

function formatClientDetails(
  c: any,
  data: Awaited<ReturnType<typeof loadClientDetails>>,
  segmentLabel: string,
): string {
  const name = `${c.lastName || ""} ${c.firstName || ""}`.trim() || "—"
  const status = c.clientStatus || c.funnelStatus
  const assignee = c.assignee ? `${c.assignee.lastName} ${c.assignee.firstName}` : "не назначен"
  // Сегмент: эффективный (ручное переопределение ?? авто-расчёт по настройкам),
  // рассчитан в buildDynamicSlice так же, как в карточке/отчёте (баг #26).
  let s = `  • ${name} | тел: ${c.phone || "—"} | статус: ${status} | сегмент: ${segmentLabel} | филиал: ${c.branch?.name || "—"} | админ: ${assignee} | баланс родителя: ${fmt(Number(c.clientBalance))} ₽\n`

  if (data.wards.length > 0) {
    s += `    Подопечные: ${data.wards.map((w: any) => `${w.firstName} ${w.lastName || ""}`.trim()).join(", ")}\n`
  }

  if (data.subs.length > 0) {
    s += `    Абонементы (последние ${data.subs.length}):\n`
    for (const sub of data.subs) {
      const period = sub.periodYear && sub.periodMonth ? `${sub.periodYear}-${String(sub.periodMonth).padStart(2, "0")}` : "—"
      s += `      - ${sub.direction?.name || "—"} / ${sub.group?.name || "—"} (${period}) ${sub.status} | сумма ${fmt(Number(sub.finalAmount))} ₽ | долг по абонементу: ${fmt(Number(sub.balance))} ₽\n`
    }
  }

  if (data.payments.length > 0) {
    s += `    Последние оплаты: ${data.payments.map((p: any) => `${fmt(Number(p.amount))}₽ (${new Date(p.date).toLocaleDateString("ru-RU")}, ${p.method})`).join("; ")}\n`
  }

  s += `    Всего оплачиваемых посещений за всё время: ${data.attendancesCount}\n`
  return s
}

// --- Группа: подробности ---

async function loadGroupDetails(groupId: string, tenantId: string, now: Date) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const [templates, recentLessons, monthAttendances, salaryRate] = await Promise.all([
    db.groupScheduleTemplate.findMany({
      where: { groupId },
      select: { dayOfWeek: true, startTime: true, durationMinutes: true },
    }),
    db.lesson.findMany({
      where: { tenantId, groupId, date: { lte: monthEnd } },
      orderBy: { date: "desc" },
      take: 5,
      select: {
        date: true, startTime: true, status: true,
        _count: { select: { attendances: true } },
      },
    }),
    db.attendance.findMany({
      where: {
        tenantId,
        lesson: { groupId, date: { gte: monthStart, lte: monthEnd } },
        attendanceType: { countsAsRevenue: true },
      },
      select: { chargeAmount: true, instructorPayAmount: true },
    }),
    db.groupSalaryRate.findUnique({
      where: { groupId },
      select: {
        scheme: true,
        ratePerStudent: true, ratePerLesson: true, fixedPerShift: true, percentOfPayments: true,
      },
    }),
  ])

  const monthRevenue = monthAttendances.reduce((s, a) => s + Number(a.chargeAmount), 0)
  const monthInstructorPay = monthAttendances.reduce((s, a) => s + Number(a.instructorPayAmount), 0)
  return { templates, recentLessons, monthRevenue, monthInstructorPay, salaryRate }
}

function formatGroupDetails(
  g: any,
  data: Awaited<ReturnType<typeof loadGroupDetails>>
): string {
  const instr = g.instructor ? `${g.instructor.lastName} ${g.instructor.firstName}` : "—"
  const fill = g.maxStudents ? Math.round((g._count.enrollments / g.maxStudents) * 100) : 0
  let s = `  • ${g.name} (${g.direction?.name || "—"}, ${g.branch?.name || "—"}) | инструктор: ${instr} | ${g._count.enrollments}/${g.maxStudents || "?"} учеников (${fill}%)\n`

  if (data.templates.length > 0) {
    const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]
    s += `    Расписание: ${data.templates.map((t: any) => `${days[t.dayOfWeek] || "?"} ${t.startTime} (${t.durationMinutes} мин)`).join(", ")}\n`
  }

  s += `    Выручка за текущий месяц: ${fmt(data.monthRevenue)} ₽ | ЗП инструктору: ${fmt(data.monthInstructorPay)} ₽\n`

  if (data.salaryRate) {
    const r = data.salaryRate
    const parts: string[] = [`схема: ${r.scheme}`]
    if (r.ratePerStudent) parts.push(`за ученика: ${fmt(Number(r.ratePerStudent))} ₽`)
    if (r.ratePerLesson) parts.push(`за занятие: ${fmt(Number(r.ratePerLesson))} ₽`)
    if (r.fixedPerShift) parts.push(`фикс за выход: ${fmt(Number(r.fixedPerShift))} ₽`)
    if (r.percentOfPayments) parts.push(`% от списаний: ${Number(r.percentOfPayments)}%`)
    s += `    Ставка группы (перебивает дефолт инструктора): ${parts.join(", ")}\n`
  }

  if (data.recentLessons.length > 0) {
    s += `    Последние занятия: ${data.recentLessons.map((l: any) => `${new Date(l.date).toLocaleDateString("ru-RU")} ${l.startTime} (${l.status}, отметок: ${l._count.attendances})`).join("; ")}\n`
  }

  return s
}

// --- Сотрудник: подробности ---

async function loadEmployeeDetails(employeeId: string, tenantId: string, now: Date) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const [groups, monthAttendances, defaultRate, assignedClients] = await Promise.all([
    db.group.findMany({
      where: { tenantId, deletedAt: null, instructorId: employeeId, isOneTime: false },
      select: {
        name: true,
        branch: { select: { name: true } },
        direction: { select: { name: true } },
        _count: { select: { enrollments: { where: { isActive: true } } } },
      },
    }),
    db.attendance.findMany({
      where: {
        tenantId,
        lesson: { instructorId: employeeId, date: { gte: monthStart, lte: monthEnd } },
        attendanceType: { countsAsRevenue: true },
      },
      select: { chargeAmount: true, instructorPayAmount: true },
    }),
    db.salaryRate.findFirst({
      where: { employeeId, directionId: null },
      select: {
        scheme: true,
        ratePerStudent: true, ratePerLesson: true, fixedPerShift: true, percentOfPayments: true,
      },
    }),
    db.client.count({
      where: { tenantId, deletedAt: null, assignedTo: employeeId, clientStatus: { not: null } },
    }),
  ])

  const monthRevenue = monthAttendances.reduce((s, a) => s + Number(a.chargeAmount), 0)
  const monthPay = monthAttendances.reduce((s, a) => s + Number(a.instructorPayAmount), 0)
  return { groups, monthRevenue, monthPay, defaultRate, assignedClients }
}

function formatEmployeeDetails(
  e: any,
  data: Awaited<ReturnType<typeof loadEmployeeDetails>>
): string {
  let s = `  • ${e.lastName} ${e.firstName} | роль: ${e.role}${e.isActive ? "" : " (неактивен)"}\n`

  if (data.defaultRate) {
    const r = data.defaultRate
    const parts: string[] = [`схема: ${r.scheme}`]
    if (r.ratePerStudent) parts.push(`за ученика: ${fmt(Number(r.ratePerStudent))} ₽`)
    if (r.ratePerLesson) parts.push(`за занятие: ${fmt(Number(r.ratePerLesson))} ₽`)
    if (r.fixedPerShift) parts.push(`фикс за выход: ${fmt(Number(r.fixedPerShift))} ₽`)
    if (r.percentOfPayments) parts.push(`% от списаний: ${Number(r.percentOfPayments)}%`)
    s += `    Ставка ЗП по умолчанию: ${parts.join(", ")}\n`
  }

  if (data.groups.length > 0) {
    s += `    Группы (${data.groups.length}):\n`
    for (const g of data.groups) {
      s += `      - ${g.name} (${g.direction?.name || "—"}, ${g.branch?.name || "—"}): ${g._count.enrollments} учеников\n`
    }
  }

  if (e.role === "instructor") {
    s += `    Текущий месяц: выручка по занятиям ${fmt(data.monthRevenue)} ₽ | начислено ЗП: ${fmt(data.monthPay)} ₽\n`
  }

  if (data.assignedClients > 0) {
    s += `    Назначено клиентов: ${data.assignedClients}\n`
  }
  return s
}

// --- Месяц: P&L ---

async function buildMonthSlice(month: MonthRange, tenantId: string): Promise<string> {
  // ОПИУ: расходы за месяц берём по периоду признания, окно выборки ±60 мес по дате платежа.
  const expWin = expenseFetchWindow(month.year, month.month, month.year, month.month)
  const [revenueAttendances, expenses, subs, churned, newLeads, firstPayments] = await Promise.all([
    db.attendance.findMany({
      where: {
        tenantId,
        lesson: { date: { gte: month.start, lte: month.end } },
        attendanceType: { countsAsRevenue: true },
      },
      select: { chargeAmount: true, instructorPayAmount: true },
    }),
    db.expense.findMany({
      where: {
        tenantId, deletedAt: null,
        date: { gte: expWin.gte, lte: expWin.lte },
        recognitionMode: { not: "not_in_pnl" },
      },
      select: {
        amount: true, date: true,
        recognitionMode: true, amortizationMonths: true, amortizationStartDate: true,
        category: { select: { name: true } },
      },
    }),
    db.subscription.findMany({
      where: {
        tenantId, deletedAt: null,
        periodYear: month.year, periodMonth: month.month,
      },
      select: { finalAmount: true, status: true },
    }),
    db.subscription.count({
      where: {
        tenantId, deletedAt: null,
        withdrawalDate: { gte: month.start, lte: month.end },
      },
    }),
    db.client.count({
      where: {
        tenantId, deletedAt: null,
        createdAt: { gte: month.start, lte: month.end },
        clientStatus: null,
      },
    }),
    db.client.count({
      where: {
        tenantId, deletedAt: null,
        firstPaymentDate: { gte: month.start, lte: month.end },
      },
    }),
  ])

  const revenue = revenueAttendances.reduce((s, a) => s + Number(a.chargeAmount), 0)
  const instructorPay = revenueAttendances.reduce((s, a) => s + Number(a.instructorPayAmount), 0)
  // ОПИУ: относим расход к месяцу признания (recognitionMode), не к дате платежа.
  const totalExpenses = expenses.reduce(
    (s, e) => s + expenseAmountInWindow(e, month.year, month.month, month.year, month.month), 0)
  const profit = revenue - totalExpenses

  const byCategory = new Map<string, number>()
  for (const e of expenses) {
    const recognized = expenseAmountInWindow(e, month.year, month.month, month.year, month.month)
    if (recognized === 0) continue
    const cat = e.category?.name || "—"
    byCategory.set(cat, (byCategory.get(cat) || 0) + recognized)
  }
  const topCats = Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const subsCount = subs.length
  const avg = subsCount > 0 ? subs.reduce((s, x) => s + Number(x.finalAmount), 0) / subsCount : 0

  let s = `Детали по месяцу ${month.name}:\n`
  s += `  Выручка: ${fmt(revenue)} ₽ | Расходы: ${fmt(totalExpenses)} ₽ | Прибыль: ${fmt(profit)} ₽\n`
  s += `  Начислено ЗП инструкторам по факту посещений: ${fmt(instructorPay)} ₽\n`
  s += `  Абонементов за период: ${subsCount} | Средний чек: ${fmt(avg)} ₽\n`
  s += `  Новых лидов: ${newLeads} | Первых оплат: ${firstPayments} | Отток: ${churned}\n`
  if (topCats.length > 0) {
    s += `  Расходы по категориям: ${topCats.map(([c, v]) => `${c} ${fmt(v)} ₽`).join("; ")}\n`
  }
  return s
}
