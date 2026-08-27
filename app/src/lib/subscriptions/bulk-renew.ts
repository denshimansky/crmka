// Массовая выписка абонементов на следующий период.
// preview — сухой просчёт; apply — транзакция: создаёт pending Subscription.
// clientBalance не трогается: долг живёт на Subscription.balance до момента
// «Оплатить с баланса» (как и в одиночном POST /api/subscriptions).
//
// Цена занятия нового абонемента = текущий прайс направления (не цена
// исходника): скидки клиента накладываются заново recalcClientDiscounts,
// подорожание направления подхватывается со следующего месяца.
//
// Что включаем: только календарные абонементы (type=calendar) — пользователь
// явно подтвердил, что массовая выписка нужна именно для них; package идут
// другим механизмом (по сроку годности).
//
// Источники продления: активные + ЗАКРЫТЫЕ ЗА ПРОШЛЫЙ МЕСЯЦ (относительно
// начала диапазона). Автозакрытие отработанных абонементов идёт ежедневно с
// 1-го числа, поэтому при выписке после 1-го добросовестные клиенты (месяц
// отхожен и оплачен → closed) без этого выпадали бы из продления. Отчисленные
// (withdrawn) не продлеваются никогда — ребёнок ушёл.
//
// Дубли: для (clientId, wardId, directionId, groupId) пропускаем, если уже
// есть pending/active с пересечением запрашиваемого периода.

import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { countLessonsForGroup } from "@/lib/schedule/count-lessons"
import {
  recalcClientDiscounts,
  setSubscriptionManualDiscount,
} from "@/lib/discounts/recalc-client-discounts"
import { ensureEnrollmentForSubscription } from "@/lib/subscriptions/ensure-enrollment"
import { computeIssuedBranches } from "@/lib/subscriptions/client-branches"
import { directionPriceAt, toUtcDay } from "@/lib/subscriptions/direction-price"
import { consumingAttendanceTypeWhere } from "@/lib/subscriptions/consumed-lessons"
import { netPaidBySubscriptions } from "@/lib/subscriptions/net-paid"
import { logSubscriptionsIssued } from "@/lib/subscriptions/audit-price"

export interface BulkRenewInput {
  tenantId: string
  rangeStart: Date
  rangeEnd: Date
  branchId?: string | null
  directionId?: string | null
  /** Если задано — продлеваем только этот конкретный source-абонемент (точечное продление из карточки клиента). */
  subscriptionId?: string | null
  createdBy?: string | null
}

export interface BulkRenewCandidate {
  sourceSubscriptionId: string
  clientId: string
  clientName: string
  wardId: string | null
  wardName: string | null
  directionId: string
  directionName: string
  groupId: string
  groupName: string
  branchId: string
  branchName: string
  lessonPrice: number
  totalLessons: number
  finalAmount: number
  hasSchedule: boolean
  // Скидки v3: пер-абонементный шаблон исходного абонемента — переносится, если
  // клиент всё ещё в режиме perSubDiscountMode.
  discountTemplateId: string | null
  perSubDiscountMode: boolean
}

export interface BulkRenewSkipped {
  sourceSubscriptionId: string
  clientName: string
  wardName: string | null
  directionName: string
  groupName: string
  reason: "already_renewed" | "no_schedule_lessons"
}

export interface OffPeriodBucket {
  year: number
  month: number // 1..12 — естественный период выписки (месяц закрытия + 1)
  count: number
}

export interface BulkRenewPreview {
  rangeStart: string // YYYY-MM-DD
  rangeEnd: string
  toCreate: BulkRenewCandidate[]
  skipped: BulkRenewSkipped[]
  // (б) Закрытые абонементы, чей естественный следующий период НЕ попадает в
  // выбранный диапазон (сгруппированы по этому периоду, только не в прошлом и
  // ещё не продлённые). Сигнал оператору, что выбран не тот месяц: вместо
  // тихого нуля показываем «за июль есть 42 закрытых — они не в этом периоде».
  offPeriodClosed: OffPeriodBucket[]
}

interface SourceRow {
  id: string
  clientId: string
  client: { id: string; firstName: string | null; lastName: string | null; perSubDiscountMode: boolean }
  discountTemplateId: string | null
  wardId: string | null
  ward: { id: string; firstName: string; lastName: string | null } | null
  directionId: string
  direction: { id: string; name: string; lessonPrice: Prisma.Decimal }
  groupId: string
  group: { id: string; name: string; branchId: string; branch: { name: string } }
  startDate: Date
}

function fullClient(c: { firstName: string | null; lastName: string | null }): string {
  return [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
}

function fullWard(w: { firstName: string; lastName: string | null } | null): string | null {
  if (!w) return null
  return [w.lastName, w.firstName].filter(Boolean).join(" ").trim() || w.firstName
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Месяц, предшествующий началу диапазона выписки (1-based). Локальные геттеры —
 * как при выводе periodYear/periodMonth нового абонемента в applyBulkRenew,
 * чтобы «прошлый месяц» и период выписки считались одинаково.
 */
export function prevMonthOfRange(rangeStart: Date): { year: number; month: number } {
  const y = rangeStart.getFullYear()
  const m = rangeStart.getMonth() + 1 // 1..12
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 }
}

// Следующий месяц (1-based) без Date — чтобы не задеть TZ.
function nextMonthOf(year: number, month1: number): { year: number; month: number } {
  return month1 === 12 ? { year: year + 1, month: 1 } : { year, month: month1 + 1 }
}

// YYYY-MM-DD границы календарного месяца (1..12) — контракт parseDay роутов.
function monthRangeStrings(year: number, month1: number): { rangeStart: string; rangeEnd: string } {
  const mm = String(month1).padStart(2, "0")
  // new Date(year, month1, 0) — month1 как индекс следующего месяца, день 0 =
  // последнее число месяца month1.
  const lastDay = new Date(year, month1, 0).getDate()
  return { rangeStart: `${year}-${mm}-01`, rangeEnd: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` }
}

/**
 * (а) Умный дефолт периода массовой выписки. Обычно центры продлевают «наперёд»
 * (в конце месяца — на следующий), поэтому базовый дефолт = следующий месяц. Но
 * если у центра ещё есть невыписанные источники за ТЕКУЩИЙ месяц (активные или
 * закрытые за прошлый месяц, которым не создан абонемент текущего месяца) —
 * значит, они «отстали» и им нужен текущий месяц: тогда дефолт = текущий.
 *
 * Иначе (штатно: всё за текущий месяц уже выписано, либо источников нет) —
 * следующий месяц, как раньше. Проверка облегчённая (без расписания групп): это
 * лишь стартовое значение полей, оператор всегда может поменять вручную.
 */
export async function suggestDefaultRenewRange(
  tenantId: string,
  filters?: { branchId?: string | null; directionId?: string | null },
): Promise<{ rangeStart: string; rangeEnd: string; reason: "current_backlog" | "next_period" }> {
  // «Сейчас» = серверные часы (getMonth локально). Осознанно согласовано с
  // гейтом «выписка задним числом» в роутах (currentMonthStart = new Date()):
  // и дефолт, и гейт коммита берут одни и те же часы, поэтому не противоречат.
  // На UTC-сервере в первые часы 1-го числа для восточных тенантов «текущий
  // месяц» может отставать — но это лишь стартовое значение поля (оператор
  // правит вручную), а не жёсткое ограничение. Пер-орг TZ в схеме нет.
  const now = new Date()
  const cur = { year: now.getFullYear(), month: now.getMonth() + 1 }
  const branchId = filters?.branchId ?? null
  const directionId = filters?.directionId ?? null

  // Источники для выписки в ТЕКУЩИЙ месяц — через сам loadSources (одна и та же
  // eligibility, без дрейфа: active + closed/pending-непустые за прошлый месяц).
  // Уважаем активный фильтр филиала/направления, чтобы подсказанный месяц
  // совпадал с тем, что реально выпишется из кнопки (ревью: иначе дефолт
  // считался тенант-широко и расходился с отфильтрованным прогоном).
  const curStart = new Date(cur.year, cur.month - 1, 1)
  const curEnd = new Date(cur.year, cur.month, 0)
  const sources = await loadSources({ tenantId, rangeStart: curStart, rangeEnd: curEnd, branchId, directionId })
  if (sources.length === 0) {
    const t = nextMonthOf(cur.year, cur.month)
    return { ...monthRangeStrings(t.year, t.month), reason: "next_period" }
  }

  // Уже выписанные в текущий месяц (приблизительно — по period, без интервала).
  const issued = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      type: "calendar",
      periodYear: cur.year,
      periodMonth: cur.month,
      ...(directionId ? { directionId } : {}),
      ...(branchId ? { group: { branchId } } : {}),
    },
    select: { clientId: true, wardId: true, directionId: true, groupId: true },
  })
  const issuedSet = new Set(
    issued.map((s) => `${s.clientId}|${s.wardId ?? ""}|${s.directionId}|${s.groupId}`),
  )
  const remaining = sources.some(
    (s) => !issuedSet.has(`${s.clientId}|${s.wardId ?? ""}|${s.directionId}|${s.groupId}`),
  )
  const target = remaining ? cur : nextMonthOf(cur.year, cur.month)
  return {
    ...monthRangeStrings(target.year, target.month),
    reason: remaining ? "current_backlog" : "next_period",
  }
}

async function loadSources(opts: BulkRenewInput): Promise<SourceRow[]> {
  const prev = prevMonthOfRange(opts.rangeStart)
  const where: Prisma.SubscriptionWhereInput = {
    tenantId: opts.tenantId,
    deletedAt: null,
    type: "calendar",
    // Не продлеваем абонементы с запланированным отчислением — ребёнок уходит.
    scheduledWithdrawalDate: null,
    // Ушедшим не выписываем: архив/ЧС (симметрично guard'у точечного
    // /api/subscriptions/[id]/renew) и soft-deleted клиенты (удаление клиента
    // не помечает его абонементы deletedAt).
    client: { deletedAt: null, funnelStatus: { notIn: ["archived", "blacklisted"] } },
    // Источники продления за прошлый месяц (решение владельца 02.08.2026):
    // продлеваем ВСЁ, кроме «пустых» и снятых руками.
    //   - active (любого периода) — как раньше;
    //   - closed И pending ЗА ПРОШЛЫЙ МЕСЯЦ (period = prev) — включая
    //     недоплаченные (partial) и неоплаченные, если по ним была активность.
    // withdrawn (отчисленные руками) и scheduledWithdrawalDate (запланированное
    // отчисление) — никогда. «Пустые» (ни оплаты, ни платного занятия) —
    // отсеиваются ниже в JS (нужен netPaid, его нельзя выразить в where).
    // closed/pending без periodYear/Month (легаси) не берём — месяц неизвестен.
    // Для точечного продления (subscriptionId) роут сам огораживает статус.
    OR: [
      { status: "active" },
      { status: { in: ["closed", "pending"] }, periodYear: prev.year, periodMonth: prev.month },
    ],
  }
  if (opts.directionId) where.directionId = opts.directionId
  if (opts.branchId) where.group = { branchId: opts.branchId }
  if (opts.subscriptionId) where.id = opts.subscriptionId

  const rows = await db.subscription.findMany({
    where,
    select: {
      id: true,
      status: true,
      clientId: true,
      client: { select: { id: true, firstName: true, lastName: true, perSubDiscountMode: true } },
      discountTemplateId: true,
      wardId: true,
      ward: { select: { id: true, firstName: true, lastName: true } },
      directionId: true,
      direction: { select: { id: true, name: true, lessonPrice: true } },
      groupId: true,
      group: { select: { id: true, name: true, branchId: true, branch: { select: { name: true } } } },
      startDate: true,
      // Признак «было платное/зачётное посещение» (take:1 — только факт наличия).
      attendances: {
        where: { isPending: false, attendanceType: consumingAttendanceTypeWhere },
        select: { id: true },
        take: 1,
      },
    },
    // status asc — тайбрейк при равном startDate: порядок enum в БД
    // (pending, active, closed, withdrawn). При равном старте предпочитаем не
    // pending: см. фильтр keyToRow ниже.
    orderBy: [{ startDate: "desc" }, { status: "asc" }],
  })

  // «Пустой» абонемент (ни оплаты, ни платного занятия) не продлеваем. Критерий
  // единый для ВСЕХ статусов: было зачётное посещение ИЛИ netPaid > 0. Нельзя
  // опираться на статус/баланс: крон close-unpaid-subscriptions авто-закрывает
  // пустой неоплаченный pending в status=closed с balance=0 (обнуляет без
  // оплаты) — «closed по определению непустой» и «balance<finalAmount ⟺ оплата»
  // для него ложны. netPaid (transfer_in − возвраты из кассы, как в net-paid.ts)
  // переживает обнуление и отражает реальную оплату (адверсариальное ревью).
  const netPaid = await netPaidBySubscriptions(db, opts.tenantId, rows.map((r) => r.id))
  const nonEmpty = rows.filter(
    (r) => r.attendances.length > 0 || (netPaid.get(r.id)?.greaterThan(0) ?? false),
  )

  // На случай нескольких строк с одним ключом (active + closed/pending одного
  // месяца) — оставляем самую свежую; при равном старте предпочитаем НЕ pending
  // (реальный оплаченный/закрытый источник), т.к. созданный абонемент от выбора
  // источника не зависит — важна лишь ссылка previousSubscriptionId.
  const keyToRow = new Map<string, (typeof rows)[number]>()
  for (const r of nonEmpty) {
    const k = `${r.clientId}|${r.wardId ?? ""}|${r.directionId}|${r.groupId}`
    const existing = keyToRow.get(k)
    if (!existing) {
      keyToRow.set(k, r)
    } else if (existing.status === "pending" && r.status !== "pending") {
      keyToRow.set(k, r)
    }
  }
  return [...keyToRow.values()]
}

// Сравнимое число YYYYMMDD. Даты-колонки приходят из БД как UTC-полночь,
// а rangeStart/rangeEnd (parseDay) — как локальная полночь; берём
// соответствующие компоненты, чтобы сравнение календарных дат не зависело от TZ.
function dayNumUTC(d: Date): number {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}
function dayNumLocal(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

// Последний день месяца (month1 — 1-based) в виде YYYYMMDD.
function monthEndDayNum(year: number, month1: number): number {
  const lastDay = new Date(year, month1, 0).getDate()
  return year * 10000 + month1 * 100 + lastDay
}

// Конец действия календарного абонемента (YYYYMMDD). У импортированных/легаси
// абонементов endDate часто null — тогда период берём по periodYear/periodMonth
// (последний день месяца), а если их нет — по месяцу startDate. Без этого null
// endDate раньше трактовался как «бессрочный», и любой июньский абонемент ложно
// «перекрывал» июль → массовая выписка пропускала всех (баг выписки на след. период).
function calendarEndDayNum(e: {
  endDate: Date | null
  periodYear: number | null
  periodMonth: number | null
  startDate: Date
}): number {
  if (e.endDate) return dayNumUTC(e.endDate)
  if (e.periodYear != null && e.periodMonth != null) {
    return monthEndDayNum(e.periodYear, e.periodMonth)
  }
  return monthEndDayNum(e.startDate.getUTCFullYear(), e.startDate.getUTCMonth() + 1)
}

type Tx = Prisma.TransactionClient | typeof db

async function loadCollisions(
  client: Tx,
  tenantId: string,
  rangeStart: Date,
  rangeEnd: Date,
  keys: Array<{ clientId: string; wardId: string | null; directionId: string; groupId: string }>,
): Promise<Set<string>> {
  if (keys.length === 0) return new Set()

  // Кандидаты: календарные абонементы ЛЮБОГО статуса (кроме удалённых), чей
  // старт не позже конца диапазона (необходимое условие пересечения). Статусы
  // closed/withdrawn тоже блокируют ключ: иначе повторный прогон выписки за
  // период, который автозакрытие уже закрыло, создал бы полные дубли, а
  // отчисленный в целевом месяце ребёнок «воскрешался» бы от closed-источника
  // прошлого месяца. Штатную позднюю выписку это не трогает: закрытый прошлый
  // месяц заканчивается до rangeStart и диапазон не пересекает. Конец периода
  // вычисляем в JS — в т.ч. для строк с пустым endDate (см. calendarEndDayNum),
  // чтобы не считать «бессрочным» календарный абонемент без endDate.
  const existing = await client.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      type: "calendar",
      startDate: { lte: rangeEnd },
    },
    select: {
      clientId: true,
      wardId: true,
      directionId: true,
      groupId: true,
      startDate: true,
      endDate: true,
      periodYear: true,
      periodMonth: true,
    },
  })

  const startNum = dayNumLocal(rangeStart)
  const endNum = dayNumLocal(rangeEnd)
  const set = new Set<string>()
  for (const e of existing) {
    // Пересечение интервалов: startDate <= rangeEnd И конецПериода >= rangeStart.
    if (dayNumUTC(e.startDate) <= endNum && calendarEndDayNum(e) >= startNum) {
      set.add(`${e.clientId}|${e.wardId ?? ""}|${e.directionId}|${e.groupId}`)
    }
  }
  return set
}

// (б) Абонементы за прошлые месяцы, чей естественный следующий период (месяц
// периода + 1) НЕ совпадает с выбранным диапазоном — то есть под этот период
// они не подходят. Те же источники, что продлевает выписка: closed и pending
// (непустые — была оплата или платное занятие), но за другой месяц. Группируем
// по естественному периоду. Фильтры: не в прошлом (гейт задним числом всё равно
// не даст выписать) и ещё не продлённые. Уважаем те же branch/direction, что и
// прогон. Для точечного продления (subscriptionId) подсказка не нужна — пусто.
async function loadOffPeriodClosed(opts: BulkRenewInput): Promise<OffPeriodBucket[]> {
  if (opts.subscriptionId) return []
  const selInScope = prevMonthOfRange(opts.rangeStart) // месяц, который ловит выбранный диапазон
  // curNum отсекает «прошедшие» естественные периоды тем же серверным клоком,
  // что и гейт бэкдейтинга в роуте, — подсказка и коммит согласованы (кнопка не
  // предложит месяц, который коммит отвергнет). См. заметку в suggestDefaultRenewRange.
  const now = new Date()
  const curNum = now.getFullYear() * 100 + (now.getMonth() + 1)

  const where: Prisma.SubscriptionWhereInput = {
    tenantId: opts.tenantId,
    deletedAt: null,
    type: "calendar",
    status: { in: ["closed", "pending"] },
    scheduledWithdrawalDate: null,
    periodYear: { not: null },
    periodMonth: { not: null },
    client: { deletedAt: null, funnelStatus: { notIn: ["archived", "blacklisted"] } },
  }
  if (opts.directionId) where.directionId = opts.directionId
  if (opts.branchId) where.group = { branchId: opts.branchId }

  const candidates = await db.subscription.findMany({
    where,
    select: {
      id: true,
      clientId: true,
      wardId: true,
      directionId: true,
      groupId: true,
      periodYear: true,
      periodMonth: true,
      attendances: {
        where: { isPending: false, attendanceType: consumingAttendanceTypeWhere },
        select: { id: true },
        take: 1,
      },
    },
  })
  // «Пустые» (ни оплаты, ни платного занятия) не считаем — их выписка не
  // продлит, подсказка не должна их обещать. Критерий единый, как в loadSources:
  // зачётное посещение ИЛИ netPaid > 0 (не статус/баланс — см. loadSources).
  const netPaid = await netPaidBySubscriptions(db, opts.tenantId, candidates.map((s) => s.id))
  const closed = candidates.filter(
    (s) => s.attendances.length > 0 || (netPaid.get(s.id)?.greaterThan(0) ?? false),
  )
  if (closed.length === 0) return []

  // Ключи всех календарных абонементов с периодом — чтобы отсеять уже продлённые.
  const issued = await db.subscription.findMany({
    where: {
      tenantId: opts.tenantId,
      deletedAt: null,
      type: "calendar",
      periodYear: { not: null },
      periodMonth: { not: null },
    },
    select: {
      clientId: true,
      wardId: true,
      directionId: true,
      groupId: true,
      periodYear: true,
      periodMonth: true,
    },
  })
  const issuedSet = new Set(
    issued.map(
      (s) => `${s.clientId}|${s.wardId ?? ""}|${s.directionId}|${s.groupId}|${s.periodYear}|${s.periodMonth}`,
    ),
  )

  const buckets = new Map<string, OffPeriodBucket>()
  const seen = new Set<string>() // дедуп по ключу+период (как keyToRow в loadSources)
  for (const s of closed) {
    const py = s.periodYear as number
    const pm = s.periodMonth as number
    // py === selInScope ⟺ естественный период == выбранному диапазону: попадает,
    // не «мимо».
    if (py === selInScope.year && pm === selInScope.month) continue
    const nt = nextMonthOf(py, pm)
    const ntNum = nt.year * 100 + nt.month
    if (ntNum < curNum) continue // период уже прошёл — выписать нельзя
    const rk = `${s.clientId}|${s.wardId ?? ""}|${s.directionId}|${s.groupId}|${nt.year}|${nt.month}`
    if (issuedSet.has(rk)) continue // уже продлён в свой период
    if (seen.has(rk)) continue // один ключ — один источник (closed+pending одного месяца)
    seen.add(rk)
    const bk = `${nt.year}-${nt.month}`
    const b = buckets.get(bk) ?? { year: nt.year, month: nt.month, count: 0 }
    b.count++
    buckets.set(bk, b)
  }
  return [...buckets.values()].sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month))
}

// includeOffPeriod=false пропускает расчёт подсказки off-period (два
// тенант-широких скана) — applyBulkRenew её не читает, поэтому на коммите не
// тратим на неё запросы (ревью: результат отбрасывался).
export async function previewBulkRenew(
  opts: BulkRenewInput,
  includeOffPeriod = true,
): Promise<BulkRenewPreview> {
  const sources = await loadSources(opts)

  // Будущие (непромоутнутые) версии цены направлений, участвующих в выписке (баг #88).
  // Цена нового абонемента = версия направления, действующая на дату старта периода
  // (rangeStart): август выписывает на сентябрь по сентябрьской ставке, если она задана.
  const directionIds = [...new Set(sources.map((s) => s.directionId))]
  const priceVersions = directionIds.length
    ? await db.directionPrice.findMany({
        where: {
          tenantId: opts.tenantId,
          directionId: { in: directionIds },
          deletedAt: null,
          appliedAt: null,
        },
        select: { directionId: true, effectiveFrom: true, lessonPrice: true, appliedAt: true, deletedAt: true },
      })
    : []
  const versionsByDir = new Map<string, typeof priceVersions>()
  for (const v of priceVersions) {
    const arr = versionsByDir.get(v.directionId) ?? []
    arr.push(v)
    versionsByDir.set(v.directionId, arr)
  }
  const startUtcDay = toUtcDay(opts.rangeStart)

  const collisionSet = await loadCollisions(
    db,
    opts.tenantId,
    opts.rangeStart,
    opts.rangeEnd,
    sources.map((s) => ({
      clientId: s.clientId,
      wardId: s.wardId,
      directionId: s.directionId,
      groupId: s.groupId,
    })),
  )

  // На один пробег по группам обычно немного групп, но запросы countLessonsForGroup
  // делаются последовательно — для 200+ строк это допустимо в 60 сек roundtrip.
  // Кеш по groupId — чтобы не считать одно и то же по нескольким клиентам.
  const groupLessonsCache = new Map<string, { count: number; hasSchedule: boolean }>()

  const toCreate: BulkRenewCandidate[] = []
  const skipped: BulkRenewSkipped[] = []

  for (const s of sources) {
    const key = `${s.clientId}|${s.wardId ?? ""}|${s.directionId}|${s.groupId}`
    const clientName = fullClient(s.client)
    const wardName = fullWard(s.ward)
    if (collisionSet.has(key)) {
      skipped.push({
        sourceSubscriptionId: s.id,
        clientName,
        wardName,
        directionName: s.direction.name,
        groupName: s.group.name,
        reason: "already_renewed",
      })
      continue
    }
    let g = groupLessonsCache.get(s.groupId)
    if (!g) {
      const r = await countLessonsForGroup({
        tenantId: opts.tenantId,
        groupId: s.groupId,
        rangeStart: opts.rangeStart,
        rangeEnd: opts.rangeEnd,
      })
      g = { count: r.count, hasSchedule: r.hasSchedule }
      groupLessonsCache.set(s.groupId, g)
    }
    if (g.count === 0) {
      skipped.push({
        sourceSubscriptionId: s.id,
        clientName,
        wardName,
        directionName: s.direction.name,
        groupName: s.group.name,
        reason: "no_schedule_lessons",
      })
      continue
    }
    // Цена выписки = прайс НАПРАВЛЕНИЯ, действующий на дату старта периода (баг #88:
    // подорожание с датой подхватывается уже при выписке вперёд), а не цена исходного
    // абонемента. Скидки клиента наложит recalcClientDiscounts после создания.
    // Копирование цены исходника дублировало скидку, «зашитую» оператором прямо
    // в цену (исходник 400 при прайсе 450 → новый 400 − 50 шаблона = 350,
    // двойная скидка), и навсегда замораживало старый прайс при подорожании.
    const price = new Prisma.Decimal(
      directionPriceAt(s.direction, versionsByDir.get(s.directionId), startUtcDay).lessonPrice,
    )
    const finalAmount = price.mul(g.count)
    toCreate.push({
      sourceSubscriptionId: s.id,
      clientId: s.clientId,
      clientName,
      wardId: s.wardId,
      wardName,
      directionId: s.directionId,
      directionName: s.direction.name,
      groupId: s.groupId,
      groupName: s.group.name,
      branchId: s.group.branchId,
      branchName: s.group.branch.name,
      lessonPrice: price.toNumber(),
      totalLessons: g.count,
      finalAmount: finalAmount.toNumber(),
      hasSchedule: g.hasSchedule,
      // Скидки v3: переносим пер-абонементный шаблон исходного абонемента (перенос
      // применит applyBulkRenew только если клиент в режиме perSubDiscountMode).
      discountTemplateId: s.discountTemplateId,
      perSubDiscountMode: s.client.perSubDiscountMode,
    })
  }

  const offPeriodClosed = includeOffPeriod ? await loadOffPeriodClosed(opts) : []

  return {
    rangeStart: ymd(opts.rangeStart),
    rangeEnd: ymd(opts.rangeEnd),
    toCreate,
    skipped,
    offPeriodClosed,
  }
}

export interface BulkRenewResult {
  created: number
  skipped: number
  totalIssuedAmount: number
}

export async function applyBulkRenew(opts: BulkRenewInput): Promise<BulkRenewResult> {
  const preview = await previewBulkRenew(opts, false) // off-period подсказка на коммите не нужна
  if (preview.toCreate.length === 0) {
    return { created: 0, skipped: preview.skipped.length, totalIssuedAmount: 0 }
  }

  const periodYear = opts.rangeStart.getFullYear()
  const periodMonth = opts.rangeStart.getMonth() + 1
  const comment = `Массовая выписка на период ${preview.rangeStart} – ${preview.rangeEnd}`

  let created = 0
  let skippedInTx = 0
  let totalIssuedAmount = new Prisma.Decimal(0)

  await db.$transaction(async (tx) => {
    // Гонка параллельных запусков (второй таб, двойной submit, ретрай по
    // таймауту): advisory-лок на тенанта держится до конца транзакции, а
    // коллизии перепроверяются уже ПОД локом — конкурент дождётся COMMIT и
    // увидит созданные pending как коллизии (unique-констрейнта на период нет).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"bulk-renew:" + opts.tenantId}, 0))`
    const freshCollisions = await loadCollisions(
      tx,
      opts.tenantId,
      opts.rangeStart,
      opts.rangeEnd,
      preview.toCreate,
    )
    const toCreate = preview.toCreate.filter(
      (c) => !freshCollisions.has(`${c.clientId}|${c.wardId ?? ""}|${c.directionId}|${c.groupId}`),
    )
    skippedInTx = preview.toCreate.length - toCreate.length

    const createdSubs: { subId: string; clientId: string }[] = []

    for (const c of toCreate) {
      const lessonPrice = new Prisma.Decimal(c.lessonPrice)
      const totalAmount = lessonPrice.mul(c.totalLessons)
      const finalAmount = totalAmount // discountAmount = 0 в массовой выписке
      const sub = await tx.subscription.create({
        data: {
          tenantId: opts.tenantId,
          clientId: c.clientId,
          wardId: c.wardId,
          directionId: c.directionId,
          groupId: c.groupId,
          type: "calendar",
          status: "pending",
          periodYear,
          periodMonth,
          lessonPrice,
          totalLessons: c.totalLessons,
          totalAmount,
          discountAmount: new Prisma.Decimal(0),
          finalAmount,
          balance: finalAmount,
          startDate: opts.rangeStart,
          endDate: opts.rangeEnd,
          previousSubscriptionId: c.sourceSubscriptionId,
          createdBy: opts.createdBy ?? undefined,
        },
        select: { id: true },
      })
      createdSubs.push({ subId: sub.id, clientId: c.clientId })
      // Скидки v3: переносим пер-абонементную скидку (тип 2) исходного абонемента —
      // только если клиент ВСЁ ЕЩЁ в режиме perSubDiscountMode. Цена нового —
      // базовая направления; шаблон выключен/не scope=subscription → не применится
      // (setSubscriptionManualDiscount проверяет). Для режимного клиента recalc
      // ниже — no-op; для обычного тип 1/тип 2 лягут пересчётом.
      if (c.perSubDiscountMode && c.discountTemplateId) {
        await setSubscriptionManualDiscount(tx, {
          tenantId: opts.tenantId,
          subscriptionId: sub.id,
          templateId: c.discountTemplateId,
          createdBy: opts.createdBy ?? null,
          isNewSubscription: true,
        })
      }
      // ADM-04 + баг #79: денормализуем два последних РАЗНЫХ филиала абонементов
      // + счётчик. Чтение внутри tx видит апдейты прошлых итераций того же
      // клиента (два ребёнка → два абонемента), поэтому сдвиг чейнится верно.
      // clientBalance НЕ трогаем — долг живёт только на Subscription.balance.
      const branches = await computeIssuedBranches(tx, c.clientId, c.branchId)
      await tx.client.update({
        where: { id: c.clientId },
        data: {
          ...branches,
          totalSubscriptionsCount: { increment: 1 },
        },
      })
      // Живое зачисление в группе: у ребёнка, чей прошлый абонемент закрыт
      // (а зачисление деактивировано кроном автозакрытия), выписка возвращает
      // его в состав с сохранением истории. Для продолжающегося — no-op.
      // Строго ДО recalcClientDiscounts (см. ensure-enrollment.ts).
      //
      // Исключение — переведённый в другую группу: перевод деактивирует
      // зачисление старой группы, но НЕ переносит абонемент (groupId источника
      // остаётся старым). Реактивация посадила бы ребёнка в состав двух групп
      // сразу. Признак — живое зачисление в другой группе того же направления;
      // абонемент при этом выписываем как раньше (модельный пробел переноса
      // абонементов при переводе — отдельная задача).
      const transferredElsewhere = await tx.groupEnrollment.findFirst({
        where: {
          tenantId: opts.tenantId,
          clientId: c.clientId,
          wardId: c.wardId,
          isActive: true,
          deletedAt: null,
          groupId: { not: c.groupId },
          group: { directionId: c.directionId },
        },
        select: { id: true },
      })
      if (!transferredElsewhere) {
        await ensureEnrollmentForSubscription(tx, {
          tenantId: opts.tenantId,
          groupId: c.groupId,
          clientId: c.clientId,
          wardId: c.wardId,
          startDate: opts.rangeStart,
        })
      }
      created++
      totalIssuedAmount = totalIssuedAmount.add(finalAmount)
    }

    // Скидки v2: один пересчёт на клиента ПОСЛЕ выписки всей его пачки —
    // тип 1 ляжет на все новые абонементы месяца, кроме самого дорогого
    // (порядок создания внутри пачки роли не играет).
    const byClient = new Map<string, string[]>()
    for (const { subId, clientId } of createdSubs) {
      if (!byClient.has(clientId)) byClient.set(clientId, [])
      byClient.get(clientId)!.push(subId)
    }
    for (const [clientId, subIds] of byClient) {
      await recalcClientDiscounts(tx, {
        tenantId: opts.tenantId,
        clientId,
        createdBy: opts.createdBy ?? null,
        newSubscriptionIds: subIds,
      })
    }

    // «Выписано на сумму» — по фактическим finalAmount ПОСЛЕ применения скидок.
    if (createdSubs.length > 0) {
      const issuedRows = await tx.subscription.findMany({
        where: { id: { in: createdSubs.map((c) => c.subId) } },
        select: { id: true, finalAmount: true },
      })
      totalIssuedAmount = issuedRows.reduce(
        (acc, r) => acc.plus(r.finalAmount),
        new Prisma.Decimal(0),
      )
      // История клиента: у каждого выписанного абонемента — событие с суммой,
      // на которую его выписали (одним INSERT на всю пачку).
      await logSubscriptionsIssued(tx, {
        tenantId: opts.tenantId,
        employeeId: opts.createdBy ?? null,
        items: issuedRows.map((r) => ({ subscriptionId: r.id, finalAmount: r.finalAmount })),
      })
    }
  }, {
    // Массовая выписка по всей базе: на крупном тенанте цикл (create абонемента +
    // update клиента + recalcClientDiscounts на каждого) не укладывается в
    // дефолтные 5 с интерактивной транзакции Prisma.
    maxWait: 20_000,
    timeout: 120_000,
  })

  if (opts.createdBy) {
    await db.auditLog.create({
      data: {
        tenantId: opts.tenantId,
        employeeId: opts.createdBy,
        action: "subscriptions_bulk_renew",
        entityType: "system",
        entityId: opts.tenantId,
        changes: {
          rangeStart: preview.rangeStart,
          rangeEnd: preview.rangeEnd,
          created,
          skipped: preview.skipped.length + skippedInTx,
          totalIssuedAmount: totalIssuedAmount.toNumber(),
          branchId: opts.branchId ?? null,
          directionId: opts.directionId ?? null,
        },
      },
    })
  }

  return {
    created,
    skipped: preview.skipped.length + skippedInTx,
    totalIssuedAmount: totalIssuedAmount.toNumber(),
  }
}
