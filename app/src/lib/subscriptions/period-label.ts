// Единая подпись «периода абонемента» для UI и API.
//
// Календарный/фиксированный абонемент живёт месяцем (periodYear/periodMonth),
// ПАКЕТНЫЙ — интервалом дат: у него period_year/period_month = NULL (в проде так
// у всех 151 пакета). Из-за этого каждое место, форматировавшее период как
// `MONTH[periodMonth] periodYear` без проверки типа, печатало на пакетах
// «undefined null» (вкладка «Посещения» карточки клиента — баг Тарасовой).
// Логика уже была продублирована в трёх местах с разным поведением на пакетах —
// здесь она одна.
//
// Конец периода пакета берём из expiresAt (срок сгорания): именно по нему
// считается покрытие занятий (subscriptionCoversDate в roster-filter.ts), а
// значит именно он объясняет партнёру, почему занятия покрыты этими датами.
// endDate у пакета — редкий фоллбэк (проставляется при закрытии).

export type SubscriptionPeriodInput =
  | {
      type?: string | null
      periodYear?: number | null
      periodMonth?: number | null
      startDate?: Date | string | null
      endDate?: Date | string | null
      expiresAt?: Date | string | null
    }
  | null
  | undefined

/** Формат месяца календарного абонемента: 08.2026 / авг 2026 / Август 2026. */
export type PeriodMonthFormat = "numeric" | "short" | "long"

const MONTH_SHORT = [
  "", "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
]

const MONTH_LONG = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

function fmtDate(d: Date | string): string | null {
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("ru-RU")
}

/**
 * Подпись периода абонемента; null — данных нет (в подзапросах с урезанным
 * select полей типа/дат может не быть, тогда период не показываем). Фоллбэк
 * («—», «Пакет») выбирает вызывающий: он зависит от места в UI.
 */
export function subscriptionPeriodLabel(
  s: SubscriptionPeriodInput,
  month: PeriodMonthFormat = "long",
): string | null {
  if (!s) return null

  if (s.type === "package") {
    const start = s.startDate ? fmtDate(s.startDate) : null
    const endRaw = s.expiresAt ?? s.endDate
    const end = endRaw ? fmtDate(endRaw) : null
    if (start && end) return `${start} – ${end}`
    if (start) return `с ${start}`
    if (end) return `до ${end}`
    return null
  }

  if (!s.periodMonth || !s.periodYear) return null
  if (month === "numeric") {
    return `${String(s.periodMonth).padStart(2, "0")}.${s.periodYear}`
  }
  const names = month === "short" ? MONTH_SHORT : MONTH_LONG
  return `${names[s.periodMonth] ?? ""} ${s.periodYear}`.trim()
}
