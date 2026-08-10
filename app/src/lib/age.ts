// Возраст подопечного: единая точка расчёта и форматирования.
// Раньше в 4 местах (карточка ребёнка, карточка родителя, обзвон, crm/children)
// жили копии, показывавшие только целые годы. Теперь показываем годы + месяцы
// («5 лет 3 мес.», «8 мес.», «1 год»).
//
// Работает и на сервере, и на клиенте. Дату рождения принимаем как Date или ISO —
// декомпозируем в UTC (birthDate хранится в БД полуночью UTC), «сейчас» по
// умолчанию — new Date(). Точность до дня достаточна: месяц засчитываем полным,
// только когда наступило нужное число.

export interface AgeParts {
  years: number
  months: number
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Полных лет и дополнительных полных месяцев на дату `now`.
 * Возвращает null, если дата рождения не задана/некорректна или в будущем.
 */
export function ageYearsMonths(
  birth: Date | string | null | undefined,
  now: Date = new Date(),
): AgeParts | null {
  const b = toDate(birth)
  if (!b) return null

  let years = now.getUTCFullYear() - b.getUTCFullYear()
  let months = now.getUTCMonth() - b.getUTCMonth()
  // Число месяца ещё не наступило — текущий месяц не полный.
  if (now.getUTCDate() < b.getUTCDate()) months--
  if (months < 0) {
    years--
    months += 12
  }
  if (years < 0) return null
  return { years, months }
}

/** Целых лет на дату `now` (для сортировки и фильтров «возраст от/до»). */
export function ageYears(
  birth: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  return ageYearsMonths(birth, now)?.years ?? null
}

/** Русское склонение «год/года/лет» после числа. */
function ruYears(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return `${n} лет`
  if (m10 === 1) return `${n} год`
  if (m10 >= 2 && m10 <= 4) return `${n} года`
  return `${n} лет`
}

/**
 * Возраст в виде «5 лет 3 мес.» / «8 мес.» / «1 год». Месяцы («мес.» —
 * несклоняемое сокращение, как у LTV) добавляем только когда они есть;
 * ровно N лет → без «0 мес.». Плейсхолдер для пустой/будущей даты — `placeholder`.
 */
export function formatAge(
  birth: Date | string | null | undefined,
  now: Date = new Date(),
  placeholder = "—",
): string {
  const parts = ageYearsMonths(birth, now)
  if (!parts) return placeholder
  const chunks: string[] = []
  if (parts.years > 0) chunks.push(ruYears(parts.years))
  if (parts.months > 0) chunks.push(`${parts.months} мес.`)
  if (chunks.length === 0) return "0 мес." // младенец младше месяца
  return chunks.join(" ")
}
