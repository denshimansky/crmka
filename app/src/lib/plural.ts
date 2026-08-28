/**
 * Русские числительные. Тексты видят люди — «1 занятий» и «осталось 2 занятий»
 * читаются как брак, а часть этих строк уходит клиенту в мессенджер и в
 * уведомления.
 */

/**
 * Форма слова по числу: 1 занятие, 2–4 занятия, 5–20 занятий.
 * @param n целое неотрицательное число
 * @param forms [одно, два, пять] — «занятие», «занятия», «занятий»
 */
export function plural(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n))
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

/** «занятие/занятия/занятий». */
export function lessonsWord(n: number): string {
  return plural(n, ["занятие", "занятия", "занятий"])
}
