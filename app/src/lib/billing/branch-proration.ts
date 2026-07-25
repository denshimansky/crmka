// Пропорциональный перерасчёт SaaS-подписки при изменении числа филиалов
// ВНУТРИ уже оплаченного периода (3/6/12 мес). Пропорция — по дням остатка
// периода. Рост числа филиалов → доплата (kind=charge), снижение → кредит
// организации (kind=credit), который гасит следующий счёт.
//
// Помесячная оплата (periodMonths ≤ 1) перерасчётом не затрагивается: новая
// цена и так подхватится ближайшим счётом. Для legacy-подписок (billingAnchorDay
// = null) это тот же 1-месячный период — ветка сюда не заходит.
//
// Всё в UTC; входные Date трактуются как полночь UTC соответствующего дня.
//
// ТЕЛЕСКОПИРОВАНИЕ нескольких смен за период: «старая» цена (oldMonthly) всегда
// берётся из текущей monthlyAmount подписки (= цена, действующая на момент этой
// смены), а не из оплаченного счёта. Поэтому две последовательные смены
// m1→m2→m3 дают charge/credit за [t1..end] по (m2−m1) и за [t2..end] по (m3−m2),
// что в сумме эквивалентно посуточной тарификации по фактическому составу.

const DAY_MS = 24 * 60 * 60 * 1000
const round2 = (n: number) => Math.round(n * 100) / 100

/** Порог мелких сумм: перерасчёт меньше этого не выставляем (шум округления). */
export const MIN_ADJUSTMENT_RUB = 1

/** Полночь UTC произвольного Date в миллисекундах (усечение времени). */
function utcMidnightMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export interface BranchProrationInput {
  /** Число месяцев оплаченного периода (1/3/6/12). ≤1 → перерасчёта нет. */
  periodMonths: number
  /** Месячная цена, действовавшая до смены (текущая monthlyAmount подписки). */
  oldMonthly: number
  /** Месячная цена после смены (по сетке тарифа для нового числа филиалов). */
  newMonthly: number
  /** Первый день оплаченного периода (из оплаченного счёта). */
  periodStart: Date
  /** Последний день оплаченного периода (из оплаченного счёта). */
  periodEnd: Date
  /** Дата смены числа филиалов («сегодня»). */
  changeDate: Date
}

export interface BranchProrationResult {
  /** charge — доплата (цена выросла), credit — кредит (цена упала). */
  kind: "charge" | "credit"
  /** Абсолютная сумма перерасчёта, > 0. Знак несёт kind. */
  amount: number
  /** Дней остатка периода [changeDate..periodEnd] включительно. */
  remainingDays: number
  /** Всего дней в периоде [periodStart..periodEnd] включительно. */
  totalDays: number
}

/**
 * Считает доплату/кредит за остаток оплаченного периода при смене цены.
 * Возвращает null, если перерасчёт не нужен:
 *   • period ≤ 1 мес (помесячная оплата);
 *   • цена не изменилась;
 *   • дата смены вне диапазона [periodStart..periodEnd];
 *   • сумма < MIN_ADJUSTMENT_RUB (шум).
 *
 * Чистая функция без БД — основная точка юнит-тестов денежной логики.
 */
export function computeBranchProration(
  input: BranchProrationInput
): BranchProrationResult | null {
  const { periodMonths, oldMonthly, newMonthly } = input

  if (periodMonths <= 1) return null
  if (newMonthly === oldMonthly) return null

  const startMs = utcMidnightMs(input.periodStart)
  const endMs = utcMidnightMs(input.periodEnd)
  const changeMs = utcMidnightMs(input.changeDate)

  // Смена вне оплаченного периода — тарифицировать нечего.
  if (changeMs < startMs || changeMs > endMs) return null

  // Дни считаем включительно с обоих концов.
  const totalDays = Math.round((endMs - startMs) / DAY_MS) + 1
  const remainingDays = Math.round((endMs - changeMs) / DAY_MS) + 1
  if (totalDays <= 0 || remainingDays <= 0) return null

  // Доля периода, оплаченного вперёд по старой цене, которую нужно
  // перетарифицировать по новой: полная разница за период × доля дней.
  const raw = (newMonthly - oldMonthly) * periodMonths * (remainingDays / totalDays)
  const amount = round2(Math.abs(raw))
  if (amount < MIN_ADJUSTMENT_RUB) return null

  return {
    kind: raw > 0 ? "charge" : "credit",
    amount,
    remainingDays,
    totalDays,
  }
}

export interface ProrationBaseInvoice {
  /** Доплатный счёт (не полноценный период) — базой перерасчёта быть не может. */
  isAdjustment: boolean
  periodStart: Date
  periodEnd: Date
  periodMonths: number
}

/**
 * Выбирает счёт-БАЗУ для перерасчёта из оплаченных счетов, покрывающих `today`:
 * только полноценный ПЕРИОДНЫЙ счёт (`isAdjustment = false`), самый свежий по
 * началу периода. Доплатные счета исключаются — иначе телескопирование считало
 * бы `totalDays` по укороченному хвосту и завышало ставку. `null`, если
 * подходящего периодного счёта нет.
 *
 * Чистая функция — точка юнит-теста регрессии выбора базы (телескопирование).
 */
export function selectProrationBase<T extends ProrationBaseInvoice>(
  invoices: T[],
  today: Date
): T | null {
  const t = utcMidnightMs(today)
  const covering = invoices.filter(
    (inv) =>
      !inv.isAdjustment &&
      utcMidnightMs(inv.periodStart) <= t &&
      t <= utcMidnightMs(inv.periodEnd)
  )
  if (covering.length === 0) return null
  return covering.reduce((a, b) =>
    utcMidnightMs(b.periodStart) > utcMidnightMs(a.periodStart) ? b : a
  )
}
