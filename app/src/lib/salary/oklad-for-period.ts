// Оклад сотрудника за конкретный месяц: история версий (OkladSchedule) + базовая
// величина (Employee.monthlySalary с Employee.okladFrom) + календарная пропорция
// неполного месяца.
//
// Зачем: оклад хранится плоским полем Employee.monthlySalary без версий/даты.
// Раньше он начислялся ЗА ЛЮБОЙ месяц (ведомость/автозаполнение/карточка считают
// «на лету»), поэтому окладник, заведённый/переведённый на оклад в августе,
// «всплывал» в июле и в любом прошлом месяце полной суммой (баг ДЦ Dream/Фирова).
//
// Правило (реш. с владельцем 07.08):
//   • okladFrom не задан (NULL) → как раньше: оклад за весь месяц (обратная
//     совместимость для действующих окладников — их не трогаем);
//   • okladFrom позже конца месяца → оклад за этот месяц НЕ начисляется (0);
//   • okladFrom в этом месяце → пропорция по КАЛЕНДАРНЫМ дням от даты начала до
//     конца месяца (v1): monthlySalary × (дней с okladFrom по конец) / дней в месяце;
//   • okladFrom в прошлом месяце (или раньше) → полный оклад.
//
// upToDay — необязательный конец окна начисления для АВАНСА «по N-е число»
// (сценарий salary-payments/accruals?upTo=…). Комбинируется с датой начала: окно
// = [startDay, min(upToDay, дней в месяце)].
//
// ВЕРСИИ ОКЛАДА (schedule, модель OkladSchedule) — «с этой даты оклад стал таким».
// Правка monthlySalary раньше переписывала прошлое (оклад 0 с августа обнулял июнь);
// версия действует только вперёд от своей даты. Расчёт месяца — ПО ДНЯМ: за каждый
// день берётся действующая в этот день сумма (последняя версия с effectiveFrom <= дня,
// иначе базовая с okladFrom, иначе 0), сумма делится на число дней месяца. Без версий
// формула тождественна прежней пропорции, поэтому существующие базы не меняются.

/** Версия оклада: с даты effectiveFrom действует amount. */
export interface OkladVersion {
  effectiveFrom: Date
  amount: number
  deletedAt?: Date | null
}

interface OkladPeriodOpts {
  okladFrom: Date | null | undefined
  periodYear: number
  /** 1–12 */
  periodMonth: number
  /** Для аванса «по N-е»: конец окна начисления (день месяца). Иначе — весь месяц. */
  upToDay?: number | null
}

/** Доля месяца, за которую начисляется оклад (0..1). */
export function okladDaysFraction(opts: OkladPeriodOpts): number {
  const { okladFrom, periodYear, periodMonth, upToDay } = opts
  // Дней в месяце периода: day 0 следующего месяца (periodMonth здесь 1-based →
  // Date.UTC(y, periodMonth, 0) = последний день periodMonth).
  const daysInMonth = new Date(Date.UTC(periodYear, periodMonth, 0)).getUTCDate()

  const endDay =
    upToDay != null ? Math.min(upToDay, daysInMonth) : daysInMonth

  let startDay = 1
  if (okladFrom) {
    const fy = okladFrom.getUTCFullYear()
    const fm = okladFrom.getUTCMonth() + 1 // 1-based
    // Оклад ещё не начал действовать в этом месяце.
    if (fy > periodYear || (fy === periodYear && fm > periodMonth)) return 0
    // Начало оклада попадает в этот месяц — считаем с его дня.
    if (fy === periodYear && fm === periodMonth) startDay = okladFrom.getUTCDate()
    // Прошлый месяц/раньше → startDay остаётся 1 (полный месяц).
  }

  const activeDays = endDay - startDay + 1
  if (activeDays <= 0) return 0
  if (activeDays >= daysInMonth) return 1
  return activeDays / daysInMonth
}

/** Календарный UTC-день как число — для сравнения дат без времени. */
const dayNum = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/**
 * Действующая сумма оклада на конкретный день: последняя версия с effectiveFrom <= дня;
 * если версий на этот день нет — базовая величина (при okladFrom <= дня или без него);
 * иначе 0 (оклад ещё не начался).
 */
export function okladAmountOnDay(
  day: Date,
  base: { monthlySalary: number; okladFrom: Date | null | undefined },
  schedule?: OkladVersion[] | null,
): number {
  const at = dayNum(day)
  // okladFrom — АБСОЛЮТНЫЙ пол: до начала оклада его нет, что бы ни говорили версии.
  // Иначе версия, ошибочно поставленная раньше даты начала, включала бы оклад за
  // месяцы, когда сотрудник ещё не был окладником, и навсегда отменяла базу.
  if (base.okladFrom && dayNum(base.okladFrom) > at) return 0
  let bestDay = -Infinity
  let bestAmount: number | null = null
  for (const v of schedule ?? []) {
    if (v.deletedAt != null) continue
    const vd = dayNum(v.effectiveFrom)
    if (vd <= at && vd > bestDay) { bestDay = vd; bestAmount = v.amount }
  }
  // Клампим к 0: отрицательная сумма (кривой импорт/правка в БД) дала бы
  // отрицательное начисление и отрицательный потолок расхода в ОПИУ.
  if (bestAmount != null) return Math.max(0, bestAmount)
  return base.monthlySalary > 0 ? base.monthlySalary : 0
}

/**
 * Сумма оклада за месяц: Σ по дням окна (действующая сумма дня) / дней в месяце.
 * Без версий тождественно прежнему monthlySalary × доля_дней.
 */
export function okladForPeriod(
  opts: OkladPeriodOpts & { monthlySalary: number; schedule?: OkladVersion[] | null },
): number {
  const { monthlySalary, okladFrom, periodYear, periodMonth, upToDay, schedule } = opts
  const hasSchedule = (schedule ?? []).some((v) => v.deletedAt == null)
  // Быстрый путь без версий — прежняя формула (и прежнее округление).
  if (!hasSchedule) {
    if (!monthlySalary || monthlySalary <= 0) return 0
    return Math.round(monthlySalary * okladDaysFraction(opts) * 100) / 100
  }

  const daysInMonth = new Date(Date.UTC(periodYear, periodMonth, 0)).getUTCDate()
  const endDay = upToDay != null ? Math.min(upToDay, daysInMonth) : daysInMonth
  // Считаем ОТРЕЗКАМИ одинаковой суммы, а не по одному дню: сумма_отрезка ×
  // (дней/дней_в_месяце) — та же операция и тот же порядок float-действий, что в
  // быстром пути (monthlySalary × okladDaysFraction). Иначе заведение версии,
  // не меняющей сумму, сдвигало бы уже выплаченный месяц на ±0,01 ₽ и оставляло
  // фантомный остаток в ведомости.
  let sum = 0
  let segAmount: number | null = null
  let segDays = 0
  const flush = () => {
    if (segAmount != null && segDays > 0) sum += segAmount * (segDays / daysInMonth)
    segDays = 0
  }
  for (let d = 1; d <= endDay; d++) {
    const amount = okladAmountOnDay(
      new Date(Date.UTC(periodYear, periodMonth - 1, d)),
      { monthlySalary, okladFrom },
      schedule,
    )
    if (segAmount === null || amount !== segAmount) {
      flush()
      segAmount = amount
    }
    segDays++
  }
  flush()
  return Math.round(sum * 100) / 100
}
