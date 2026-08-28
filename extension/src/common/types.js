/**
 * Общие типы расширения (JSDoc — сборки нет, типы проверяются `tsc --noEmit`,
 * см. extension/README.md).
 *
 * Здесь же — контракт сообщений между частями расширения. Их три:
 *   • content script (в странице мессенджера) — знает, какой чат открыт;
 *   • service worker — единственный, кто ходит в API CRMka (у него
 *     host_permissions, поэтому CORS не мешает) и хранит настройки;
 *   • side panel — рисует карточку.
 *
 * Content script и панель между собой НЕ общаются: всё через service worker,
 * иначе состояние разъедется при переключении вкладок.
 */

/**
 * @typedef {"telegram" | "whatsapp" | "vk" | "max"} Channel
 */

/**
 * Открытый чат глазами адаптера мессенджера.
 * @typedef {object} ChatContext
 * @property {Channel} channel
 * @property {string} chatId    Идентификатор собеседника (@username или числовой id).
 * @property {string|null} title Отображаемое имя собеседника, если удалось прочитать.
 * @property {string|null} phone Телефон, если канал его отдаёт (Telegram — почти никогда).
 */

/**
 * Одно сообщение, видимое на экране.
 * @typedef {object} ChatMessage
 * @property {string} externalId Стабильный id сообщения в пределах чата.
 * @property {"incoming"|"outgoing"} direction
 * @property {string} text
 * @property {string|null} sentAt ISO-время отправки, если удалось прочитать.
 */

/**
 * Настройки расширения (chrome.storage.local).
 * @typedef {object} ExtSettings
 * @property {string} baseUrl Адрес CRM, например https://app.umnayacrm.ru
 * @property {string} token   Персональный токен сотрудника (crmka_…)
 * @property {boolean} logMessages Записывать ли увиденную переписку в CRM.
 */

/**
 * Ответ /api/ext/resolve.
 * @typedef {object} ResolveResult
 * @property {"binding"|"phone"|"handle"|"none"} match
 * @property {string|null} clientId
 * @property {Array<{id: string, name: string, phone: string|null, funnelStatus: string, clientStatus: string|null}>} candidates
 * @property {string|null} chatId
 */

/**
 * Сколько последних сообщений чата заливаем в CRM за один проход.
 *
 * Ровно столько же панель и показывает в блоке «Переписка и события» — история
 * целиком живёт в карточке клиента в CRM. Маленькое число здесь принципиально:
 * иначе при первом открытии чата в ленту коммуникаций разом падает вся старая
 * переписка и топит настоящие события CRM (задачи, звонки, заметки). Дальше
 * новые сообщения долетают по одному — в реальном времени.
 */
export const SYNC_MESSAGES_LIMIT = 10

/** Сообщения content script → service worker. */
export const MSG_CHAT_CHANGED = "chat-changed"
/** Content script → service worker: в открытом чате появились/изменились сообщения. */
export const MSG_CHAT_ACTIVITY = "chat-activity"
/** Сообщение service worker → content script: «отдай видимые сообщения». */
export const MSG_COLLECT_MESSAGES = "collect-messages"
/**
 * Панель → service worker → content script: вставить текст в поле ввода
 * мессенджера. Именно ВСТАВИТЬ — отправляет всегда человек (принцип-щит
 * docs/messenger-extension.md §3: ноль автоотправки, иначе это рассылочный
 * инструмент со всеми последствиями в сторах и у самих мессенджеров).
 */
export const MSG_INSERT_TEXT = "insert-text"
/** Сообщения панели → service worker. */
export const MSG_GET_STATE = "get-state"
export const MSG_SAVE_SETTINGS = "save-settings"
export const MSG_API = "api-call"
export const MSG_SYNC_MESSAGES = "sync-messages"
/** Service worker → панель: состояние изменилось (сменился чат/вкладка). */
export const MSG_STATE_CHANGED = "state-changed"
/** Service worker → content script: «ты живой?» — отличаем «скрипт не подключён» от «чат не открыт». */
export const MSG_PING = "ping"
/** Панель → service worker: перезагрузить вкладку мессенджера (чтобы подхватился content script). */
export const MSG_RELOAD_TAB = "reload-tab"

export {}
