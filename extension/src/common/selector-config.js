/**
 * Приём удалённого конфига селекторов (docs/messenger-extension.md §3, Шаг 4).
 *
 * ЗАЧЕМ ВООБЩЕ. Адаптеры цепляются за разметку чужих сайтов. У MAX она меняется
 * по расписанию: Svelte хеширует классы на каждой сборке, и авторскую часть тоже
 * могут переименовать. Селектор, зашитый в код, чинится публикацией в стор — это
 * дни ревью, и всё это время канал мёртв у всех сразу. MV3 запрещает удалённый
 * КОД, но разрешает удалённые ДАННЫЕ: селекторы приезжают из нашей же CRM.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ С ПРОВЕРКАМИ. Конфиг приходит по сети и попадает прямо
 * в `querySelectorAll`. Опечатка в нём (невалидный CSS) уронила бы разбор
 * ИСКЛЮЧЕНИЕМ — то есть механизм починки стал бы способом сломать канал сильнее,
 * чем он сломан. Поэтому здесь параноидальный приём: чужое значение принимается,
 * только если оно того же типа, что встроенное, непустое и разбирается как
 * селектор (проверку разбора передаёт вызывающий — она требует DOM).
 *
 * Чистые функции, покрыты тестами (src/__tests__/selector-config.test.js).
 */

/** Ключ в chrome.storage.local, под которым service worker держит кэш конфига. */
export const SELECTOR_CONFIG_KEY = "selectorConfig"

/**
 * Сколько кэш считается свежим. Шесть часов — компромисс: авария чинится в
 * пределах рабочего дня без просьбы «перезапустите браузер», а фонового трафика
 * почти нет (один запрос на открытие панели, не чаще раза в 6 часов).
 */
export const SELECTOR_CONFIG_TTL_MS = 6 * 60 * 60 * 1000

/**
 * Разобрать ответ сервера. Возвращает только то, что похоже на конфиг, — всё
 * остальное отбрасываем целиком: половинчато принятый конфиг хуже отсутствующего.
 *
 * @param {any} payload Тело ответа /api/ext/selectors.
 * @returns {{version: number, updatedAt: string|null, channels: Record<string, any>}|null}
 */
export function parseSelectorConfig(payload) {
  if (!payload || typeof payload !== "object") return null
  const channels = payload.channels
  // Пустой объект каналов — штатное состояние («у нас всё в порядке»), а вот
  // его отсутствие означает, что приехало не то (страница логина, прокси).
  if (!channels || typeof channels !== "object" || Array.isArray(channels)) return null
  return {
    version: Number.isFinite(payload.version) ? Number(payload.version) : 0,
    updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
    channels,
  }
}

/**
 * Переопределения для одного канала из кэша.
 *
 * @param {any} cached Значение из chrome.storage.local[SELECTOR_CONFIG_KEY].
 * @param {string} channel
 * @returns {Record<string, unknown>} Пустой объект, если ничего нет.
 */
export function readChannelOverrides(cached, channel) {
  const channels = cached?.channels
  if (!channels || typeof channels !== "object") return {}
  const overrides = channels[channel]
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return {}
  return overrides
}

/**
 * Встроенные селекторы + переопределения, с проверкой каждого значения.
 *
 * ПРАВИЛА ПРИЁМА (нарушено любое — значение игнорируется, остаётся встроенное):
 *   • ключ есть среди встроенных. Неизвестные не добавляем: они всё равно
 *     никем не читаются, зато опечатка «bubbles» вместо «bubble» выглядела бы
 *     применённой и увела бы починку не туда;
 *   • тип совпадает со встроенным (строка ↔ строка, список ↔ список);
 *   • строки непустые после обрезки пробелов;
 *   • селектор разбирается браузером — это и есть главная защита.
 *
 * Значения по умолчанию НЕ мутируем: вызывающий держит их как эталон и должен
 * иметь возможность применить конфиг повторно (кэш обновился) от того же начала.
 *
 * @template {Record<string, string|string[]>} T
 * @param {T} defaults Встроенные селекторы канала.
 * @param {Record<string, unknown>} overrides Что приехало с сервера.
 * @param {(selector: string) => boolean} [isValidSelector] Проверка разбора;
 *   по умолчанию считаем валидным всё (для тестов без DOM).
 * @returns {{selectors: T, applied: string[], rejected: string[]}} applied и
 *   rejected — для диагностики: молчаливый отказ конфига дороже самой аварии.
 */
export function mergeSelectors(defaults, overrides, isValidSelector = () => true) {
  const selectors = /** @type {T} */ ({ ...defaults })
  /** @type {string[]} */
  const applied = []
  /** @type {string[]} */
  const rejected = []

  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
      rejected.push(key)
      continue
    }
    const fallback = defaults[key]
    const accepted = Array.isArray(fallback)
      ? acceptList(value, isValidSelector)
      : acceptString(value, isValidSelector)
    if (accepted === null) {
      rejected.push(key)
      continue
    }
    // @ts-expect-error — ключ проверен выше, тип совпадает со встроенным.
    selectors[key] = accepted
    applied.push(key)
  }

  return { selectors, applied, rejected }
}

/**
 * @param {unknown} value
 * @param {(selector: string) => boolean} isValidSelector
 * @returns {string|null}
 */
function acceptString(value, isValidSelector) {
  if (typeof value !== "string") return null
  const selector = value.trim()
  if (!selector) return null
  return isValidSelector(selector) ? selector : null
}

/**
 * Список кандидатов принимаем ЦЕЛИКОМ или не принимаем вовсе: порядок в нём
 * значим (пробуем сверху вниз), и молча выкинутый из середины элемент дал бы
 * поведение, которого никто не заказывал.
 *
 * @param {unknown} value
 * @param {(selector: string) => boolean} isValidSelector
 * @returns {string[]|null}
 */
function acceptList(value, isValidSelector) {
  if (!Array.isArray(value) || value.length === 0) return null
  /** @type {string[]} */
  const out = []
  for (const item of value) {
    const selector = acceptString(item, isValidSelector)
    if (!selector) return null
    out.push(selector)
  }
  return out
}
