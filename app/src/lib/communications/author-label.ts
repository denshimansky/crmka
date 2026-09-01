/**
 * Подпись автора строки в ленте коммуникаций.
 *
 * Обычную запись подписывает сотрудник (заметка в CRM, результат обзвона). Но
 * всё, что приходит из браузерного расширения-панели, подписывается НАЗВАНИЕМ
 * ТОКЕНА — рабочим местом: «ПК Филиал 1» (docs/messenger-extension.md).
 *
 * Почему не сотрудником: токен выпускает владелец и раздаёт по компьютерам, а
 * за компьютером посменно работают разные администраторы. Подпись «Малафеев
 * Дмитрий» под сообщением, которое написала администратор смены, — ложь в
 * данных: по ней нельзя выяснить, кто на самом деле вёл общение. Название
 * рабочего места отвечает на этот вопрос ровно настолько, насколько мы его
 * знаем.
 *
 * Снимок, а не ссылка: название кладётся в metadata.device в момент записи, и
 * переименование или отзыв токена задним числом историю не переписывает.
 *
 * Файл сознательно без импортов — его одинаково используют серверные роуты и
 * клиентские компоненты ленты.
 */

/** Ключ в Communication.metadata, куда расширение кладёт название токена. */
export const COMMUNICATION_DEVICE_KEY = "device"

/** Название рабочего места из metadata записи (null у записей, сделанных в CRM). */
export function readCommunicationDevice(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[COMMUNICATION_DEVICE_KEY]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

/** «Фамилия Имя» сотрудника — как во всех лентах CRM. */
export function employeeDisplayName(
  employee: { firstName?: string | null; lastName?: string | null } | null | undefined,
): string | null {
  if (!employee) return null
  return [employee.lastName, employee.firstName].filter(Boolean).join(" ") || null
}

/**
 * Кого показать автором строки: рабочее место, если запись сделана из панели,
 * иначе сотрудника. Строки расширения, залитые до 01.09.2026, поля device не
 * имеют — у них останется прежняя подпись сотрудником.
 */
export function communicationAuthorLabel(
  metadata: unknown,
  employee: { firstName?: string | null; lastName?: string | null } | null | undefined,
): string | null {
  return readCommunicationDevice(metadata) ?? employeeDisplayName(employee)
}
