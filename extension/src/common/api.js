/**
 * Клиент API CRMka (/api/ext/*).
 *
 * Живёт ТОЛЬКО в service worker: у него есть host_permissions на домен CRM,
 * поэтому запросы не упираются в CORS страницы мессенджера, а токен не попадает
 * в контекст самой страницы (её скрипты не должны его видеть).
 *
 * @typedef {import("./types.js").ExtSettings} ExtSettings
 * @typedef {import("./types.js").ResolveResult} ResolveResult
 * @typedef {import("./types.js").Channel} Channel
 * @typedef {import("./types.js").ChatMessage} ChatMessage
 */

/** Ошибка обращения к API: код нужен панели, чтобы отличить «нет токена» от «нет клиента». */
export class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

/**
 * @param {ExtSettings} settings
 * @param {string} path
 * @param {{method?: string, body?: unknown, query?: Record<string, string|null|undefined>}} [options]
 * @returns {Promise<any>}
 */
async function request(settings, path, options = {}) {
  if (!settings.baseUrl || !settings.token) {
    throw new ApiError(0, "Расширение не подключено к CRM")
  }

  const url = new URL(path, settings.baseUrl)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, value)
  }

  let response
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${settings.token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    // Сеть недоступна, VPN отвалился, домен не резолвится — панель должна
    // сказать это человеческим языком, а не «Failed to fetch».
    throw new ApiError(0, "Не удалось связаться с CRM. Проверьте адрес и интернет.")
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    // Пустое тело — норма для некоторых ответов.
  }

  if (!response.ok) {
    throw new ApiError(response.status, data?.error || `Ошибка ${response.status}`)
  }
  return data
}

/**
 * Кто открыт в чате.
 * @param {ExtSettings} settings
 * @param {{channel: Channel, chatId: string, phone?: string|null}} chat
 * @returns {Promise<ResolveResult>}
 */
export function resolveChat(settings, chat) {
  return request(settings, "/api/ext/resolve", {
    query: { channel: chat.channel, chatId: chat.chatId, phone: chat.phone },
  })
}

/**
 * Карточка клиента одним запросом.
 * @param {ExtSettings} settings
 * @param {string} clientId
 */
export function fetchClientCard(settings, clientId) {
  return request(settings, "/api/ext/client-card", { query: { clientId } })
}

/**
 * Поиск клиента для ручной привязки (в Telegram телефона нет — ищет человек).
 * @param {ExtSettings} settings
 * @param {string} q
 * @returns {Promise<{clients: Array<{id: string, name: string, phone: string|null, stateLabel: string}>}>}
 */
export function searchClients(settings, q) {
  return request(settings, "/api/ext/clients/search", { query: { q } })
}

/**
 * Привязать чат к клиенту (явное действие сотрудника).
 * @param {ExtSettings} settings
 * @param {{channel: Channel, chatId: string, clientId: string, displayName?: string|null, saveHandle?: boolean}} payload
 */
export function createBinding(settings, payload) {
  return request(settings, "/api/ext/bindings", { method: "POST", body: payload })
}

/**
 * Отвязать чат.
 * @param {ExtSettings} settings
 * @param {{channel: Channel, chatId: string}} payload
 */
export function deleteBinding(settings, payload) {
  return request(settings, "/api/ext/bindings", { method: "DELETE", body: payload })
}

/**
 * Залить увиденные сообщения. Идемпотентно: повторы сервер пропускает по
 * ключу (канал, чат, id сообщения), поэтому слать одно и то же не страшно.
 * @param {ExtSettings} settings
 * @param {{clientId: string, channel: Channel, chatId: string, messages: ChatMessage[]}} payload
 * @returns {Promise<{created: number, skipped: number}>}
 */
export function syncMessages(settings, payload) {
  return request(settings, "/api/ext/communications/batch", { method: "POST", body: payload })
}
