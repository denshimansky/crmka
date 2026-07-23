const MASK = "•••••"

/**
 * Маскирует телефон для роли «инструктор». По умолчанию инструкторы не видят
 * клиентскую базу; владелец может открыть телефоны настройкой организации
 * `instructorsSeePhones` (Настройки → Организация) — тогда маска снимается.
 *
 * Флаг берётся из сессии: session.user.instructorsSeePhones.
 *
 * Использовать на серверной стороне (API + server components), до отправки данных
 * клиенту — иначе номер можно прочитать в Network-вкладке браузера.
 */
export function maskPhone(
  phone: string | null | undefined,
  role: string,
  instructorsSeePhones: boolean,
): string | null {
  if (!phone) return null
  if (role === "instructor" && !instructorsSeePhones) return MASK
  return phone
}

/**
 * Может ли роль выгружать список клиентов в Excel/CSV. Жёсткая политика:
 * инструктор — нельзя, никогда.
 */
export function canExportClients(role: string): boolean {
  return role !== "instructor"
}
