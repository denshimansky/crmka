const MASK = "•••••"

/**
 * Маскирует телефон для роли «инструктор» — политика жёсткая и не настраивается.
 * Бизнес-правило: педагоги не видят клиентскую базу.
 *
 * Использовать на серверной стороне (API + server components), до отправки данных
 * клиенту — иначе номер можно прочитать в Network-вкладке браузера.
 */
export function maskPhone(phone: string | null | undefined, role: string): string | null {
  if (!phone) return null
  if (role === "instructor") return MASK
  return phone
}

/**
 * Может ли роль выгружать список клиентов в Excel/CSV. Жёсткая политика:
 * инструктор — нельзя, никогда.
 */
export function canExportClients(role: string): boolean {
  return role !== "instructor"
}
