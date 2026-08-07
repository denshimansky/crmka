// Оклад сотрудника за конкретный месяц с учётом даты начала оклада
// (Employee.okladFrom) и календарной пропорции неполного первого месяца.
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

/** Сумма оклада за месяц с учётом даты начала и пропорции (0 если не окладник/не начался). */
export function okladForPeriod(
  opts: OkladPeriodOpts & { monthlySalary: number },
): number {
  if (!opts.monthlySalary || opts.monthlySalary <= 0) return 0
  const amount = opts.monthlySalary * okladDaysFraction(opts)
  return Math.round(amount * 100) / 100
}
