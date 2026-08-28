/**
 * Адаптер Telegram Web (content script, isolated world).
 *
 * Что важно знать про Telegram (см. docs/messenger-extension.md §2):
 *   • это ДВА разных клиента на одном хосте — /k (WebK, Solid.js) и /a (WebA,
 *     React). У них разный DOM и разный формат хэша, поэтому два набора
 *     селекторов;
 *   • самый стабильный сигнал «какой чат открыт» — window.location.hash:
 *     WebK пишет «#@username» либо «#<peerId>», WebA — всегда числовой «#<id>»
 *     (иногда с суффиксами через «_»);
 *   • телефона собеседника здесь нет практически никогда (виден только
 *     сохранённым контактам), поэтому клиент ищется по @username / id, а если
 *     не нашёлся — сотрудник привязывает чат руками, и связка запоминается.
 *
 * Безопасность: НЕ читаем localStorage/IndexedDB Telegram — там лежит токен
 * сессии, именно его воруют зловредные расширения. Работаем только с адресной
 * строкой и видимым DOM.
 */

const MSG_CHAT_CHANGED = "chat-changed"
const MSG_COLLECT_MESSAGES = "collect-messages"

/** @typedef {import("../common/types.js").ChatContext} ChatContext */
/** @typedef {import("../common/types.js").ChatMessage} ChatMessage */

// Content script в MV3 — классический скрипт, статический import в нём
// невозможен. Разбор хэша вынесен в отдельный модуль (он покрыт тестами),
// поэтому подтягиваем его динамически; файл объявлен в web_accessible_resources.
/** @type {typeof import("../common/telegram-hash.js").parseTelegramChatId} */
let parseTelegramChatId
/** @type {typeof import("../common/telegram-hash.js").detectTelegramClient} */
let detectTelegramClient

/** Какой из двух клиентов открыт. @returns {"k"|"a"} */
function detectClient() {
  return detectTelegramClient(location.pathname)
}

/**
 * Идентификатор открытого чата из адресной строки. Разбор — в чистом модуле
 * common/telegram-hash.js, он покрыт тестами (формат хэша — хрупкий стык).
 * @returns {string|null}
 */
function readChatIdFromHash() {
  return parseTelegramChatId(location.hash)
}

/** Имя собеседника из шапки чата — подсказка при ручной привязке. */
function readChatTitle() {
  const selectors =
    detectClient() === "a"
      ? ["#MiddleColumn .chat-info .title", "#MiddleColumn .ChatInfo .title"]
      : [".chat-info .peer-title", ".sidebar-header .peer-title", ".chat-info .user-title"]
  for (const selector of selectors) {
    const node = document.querySelector(selector)
    const text = node?.textContent?.trim()
    if (text) return text
  }
  return null
}

/**
 * Видимые сообщения открытого чата.
 *
 * WebK: пузырь — .bubble[data-mid], направление в классах is-in/is-out,
 *       время в data-timestamp (unix-секунды).
 * WebA: элемент с id="message-<id>", исходящее помечено классом own.
 *
 * Служебные сообщения («вступил в чат») пропускаем. Берём хвост: панель шлёт
 * на сервер последние N, сервер отбрасывает уже известные.
 * @returns {ChatMessage[]}
 */
function collectVisibleMessages() {
  return detectClient() === "a" ? collectWebA() : collectWebK()
}

/** @returns {ChatMessage[]} */
function collectWebK() {
  /** @type {ChatMessage[]} */
  const out = []
  const nodes = document.querySelectorAll(".bubble[data-mid]")
  for (const node of nodes) {
    if (node.classList.contains("service")) continue
    const el = /** @type {HTMLElement} */ (node)
    const mid = el.dataset.mid
    if (!mid) continue
    const text = el.querySelector(".message")?.textContent?.trim() ?? ""
    if (!text) continue
    const timestamp = Number(el.dataset.timestamp)
    out.push({
      externalId: mid,
      direction: el.classList.contains("is-out") ? "outgoing" : "incoming",
      text,
      sentAt: Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp * 1000).toISOString()
        : null,
    })
  }
  return out
}

/** @returns {ChatMessage[]} */
function collectWebA() {
  /** @type {ChatMessage[]} */
  const out = []
  const nodes = document.querySelectorAll('[id^="message-"]')
  for (const node of nodes) {
    const el = /** @type {HTMLElement} */ (node)
    // «message-<id>» и «message-<id>-<index>» у альбомов: берём первую часть.
    const id = el.id.slice("message-".length).split("-")[0]
    if (!id || !/^\d+$/.test(id)) continue
    if (out.some((m) => m.externalId === id)) continue
    const text = el.querySelector(".text-content")?.textContent?.trim() ?? ""
    if (!text) continue
    out.push({
      externalId: id,
      direction: el.classList.contains("own") ? "outgoing" : "incoming",
      text,
      // WebA не отдаёт машинное время в разметке — сервер подставит своё.
      sentAt: null,
    })
  }
  return out
}

/** @type {string|null} */
let lastChatId = null
/** @type {string|null} */
let lastTitle = null

/** Сообщить service worker, какой чат открыт. */
function reportChat() {
  if (!parseTelegramChatId) return
  const chatId = readChatIdFromHash()
  const title = chatId ? readChatTitle() : null
  if (chatId === lastChatId && title === lastTitle) return
  lastChatId = chatId
  lastTitle = title

  /** @type {ChatContext|null} */
  const chat = chatId ? { channel: "telegram", chatId, title, phone: null } : null

  chrome.runtime.sendMessage({ type: MSG_CHAT_CHANGED, chat }).catch(() => {})
}

// Смена чата — это смена хэша (клиент SPA, полноценной навигации нет).
window.addEventListener("hashchange", () => reportChat())

// Заголовок чата подгружается позже хэша, поэтому дожидаемся его наблюдателем.
// Telegram перерисовывает разметку постоянно, поэтому: (1) дебаунс, (2) reportChat
// сам сравнивает значения и молчит, если ничего не изменилось — иначе мы бы
// заваливали service worker сообщениями на каждый кадр анимации.
/** @type {ReturnType<typeof setTimeout>|undefined} */
let reportTimer
const domObserver = new MutationObserver(() => {
  clearTimeout(reportTimer)
  reportTimer = setTimeout(reportChat, 300)
})
domObserver.observe(document.body, { childList: true, subtree: true })

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG_COLLECT_MESSAGES) {
    sendResponse({ messages: collectVisibleMessages() })
  }
  return false
})

// Старт: сначала подгружаем разбор хэша, потом сообщаем открытый чат.
// До загрузки модуля reportChat не вызываем — иначе упадём на undefined.
import(chrome.runtime.getURL("src/common/telegram-hash.js"))
  .then((module) => {
    parseTelegramChatId = module.parseTelegramChatId
    detectTelegramClient = module.detectTelegramClient
    reportChat()
  })
  .catch(() => {
    // Модуль не загрузился (крайне маловероятно — файл свой же). Панель
    // покажет «откройте чат»: лучше, чем сломанная страница мессенджера.
  })
