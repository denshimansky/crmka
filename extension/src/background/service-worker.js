/**
 * Service worker — центр расширения.
 *
 * Отвечает за три вещи:
 *   1. хранит настройки (адрес CRM, токен, тумблер записи переписки);
 *   2. знает, какой чат открыт в какой вкладке (сообщают content scripts);
 *   3. единственный ходит в API CRMka — токен не попадает в страницу мессенджера,
 *      а host_permissions снимают вопрос CORS.
 *
 * Состояние по вкладкам держим в памяти: service worker в MV3 засыпает, но при
 * пробуждении панель сама перезапросит состояние, а content script пришлёт чат
 * заново при следующей смене диалога.
 */

import {
  MSG_AI_DRAFT,
  MSG_API,
  MSG_CHAT_ACTIVITY,
  MSG_CHAT_CHANGED,
  MSG_COLLECT_MESSAGES,
  MSG_GET_STATE,
  MSG_INSERT_TEXT,
  MSG_PING,
  MSG_RELOAD_TAB,
  MSG_SAVE_SETTINGS,
  MSG_STATE_CHANGED,
  MSG_SYNC_MESSAGES,
  SYNC_MESSAGES_LIMIT,
} from "../common/types.js"
import {
  ApiError,
  createBinding,
  fetchAiReply,
  deleteBinding,
  fetchClientCard,
  fetchQuickInfo,
  fetchTemplates,
  resolveChat,
  searchClients,
  syncMessages,
} from "../common/api.js"

/** @typedef {import("../common/types.js").ChatContext} ChatContext */
/** @typedef {import("../common/types.js").ExtSettings} ExtSettings */

/** Открытый чат по вкладкам. @type {Map<number, ChatContext>} */
const chatByTab = new Map()

/** @type {ExtSettings} */
const DEFAULT_SETTINGS = {
  // Боевая база живёт на msk1 (Timeweb). app.umnayacrm.ru зарезервирован под
  // будущее переключение, но сейчас у него сертификат на другое имя — fetch
  // отсюда туда не пройдёт вовсе. Когда домен переключат и выпустят
  // сертификат, адрес меняется в панели без обновления расширения.
  baseUrl: "https://msk1.umnayacrm.ru",
  token: "",
  // Запись переписки в CRM выключена по умолчанию: это обработка персональных
  // данных, включать её должен человек осознанно (см. docs/messenger-extension.md).
  logMessages: false,
}

/** @returns {Promise<ExtSettings>} */
async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS)
  return /** @type {ExtSettings} */ ({ ...DEFAULT_SETTINGS, ...stored })
}

/**
 * Хосты, на которых работают адаптеры. Держим здесь, а не только в манифесте:
 * по этому же списку чиним уже открытые вкладки (см. injectIntoOpenTabs).
 */
const MESSENGER_URL_PATTERNS = ["https://web.telegram.org/*"]

/**
 * Content script штатно попадает только в те вкладки, которые загрузились ПОСЛЕ
 * установки расширения. Если Telegram был открыт заранее (обычный случай:
 * поставил расширение — вкладка уже висит), панель не узнает про открытый чат,
 * пока человек не нажмёт F5. Поэтому при установке и при старте браузера
 * доинжектируем скрипт в уже открытые вкладки сами.
 */
async function injectIntoOpenTabs() {
  const scripts = chrome.runtime.getManifest().content_scripts ?? []
  const tabs = await chrome.tabs.query({ url: MESSENGER_URL_PATTERNS })
  for (const tab of tabs) {
    if (tab.id == null) continue
    for (const entry of scripts) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: entry.js ?? [] })
      } catch {
        // Вкладка закрылась, страница ещё грузится или это служебный URL —
        // не страшно: при следующей загрузке скрипт попадёт туда штатно.
      }
    }
  }
}

/** Панель открывается кликом по иконке расширения. */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  void injectIntoOpenTabs()
})

chrome.runtime.onStartup.addListener(() => {
  void injectIntoOpenTabs()
})

/** Активная вкладка — та, чей чат показываем в панели. */
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab?.id ?? null
}

/** Сообщить панели, что состояние изменилось. Панель может быть закрыта — ошибку глотаем. */
function notifyPanel() {
  chrome.runtime.sendMessage({ type: MSG_STATE_CHANGED }).catch(() => {})
}

/**
 * Спросить content script вкладки, что там открыто.
 *
 * Нужен не только для диагностики: chatByTab живёт в памяти, а service worker
 * в MV3 засыпает через ~30 секунд простоя и всё забывает. Content script при
 * этом продолжает работать и чат знает — поэтому после сна состояние
 * восстанавливаем у него, а не заставляем человека перезагружать Telegram.
 *
 * @param {number} tabId
 * @returns {Promise<{alive: boolean, chat: ChatContext|null}>}
 */
async function pingTab(tabId) {
  const pong = await chrome.tabs.sendMessage(tabId, { type: MSG_PING }).catch(() => null)
  if (!pong?.alive) return { alive: false, chat: null }
  const chat = /** @type {ChatContext|null} */ (pong.chat ?? null)
  if (chat) chatByTab.set(tabId, chat)
  return { alive: true, chat }
}

/**
 * Чат вкладки: из памяти, а если её сдуло сном — у content script.
 * @param {number|null} tabId
 * @returns {Promise<ChatContext|null>}
 */
async function getChatForTab(tabId) {
  if (tabId == null) return null
  const known = chatByTab.get(tabId)
  if (known) return known
  const { chat } = await pingTab(tabId)
  return chat
}

chrome.tabs.onActivated.addListener(() => notifyPanel())
chrome.tabs.onRemoved.addListener((tabId) => {
  chatByTab.delete(tabId)
})

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Неизвестная ошибка",
        status: error instanceof ApiError ? error.status : undefined,
      })
    })
  // true — ответ будет асинхронным.
  return true
})

/**
 * @param {any} message
 * @param {chrome.runtime.MessageSender} sender
 */
async function handleMessage(message, sender) {
  switch (message?.type) {
    case MSG_CHAT_CHANGED: {
      const tabId = sender.tab?.id
      if (tabId == null) return null
      const chat = /** @type {ChatContext|null} */ (message.chat)
      if (chat) chatByTab.set(tabId, chat)
      else chatByTab.delete(tabId)
      notifyPanel()
      return null
    }

    case MSG_CHAT_ACTIVITY: {
      // В открытом чате появилось новое сообщение. Заодно освежаем память о
      // чате: сигнал приходит и после сна service worker.
      const tabId = sender.tab?.id
      if (tabId == null) return null
      const chat = /** @type {ChatContext|null} */ (message.chat)
      if (chat) chatByTab.set(tabId, chat)
      // Панель показывает активную вкладку — чужие вкладки её не касаются.
      const activeTabId = await getActiveTabId()
      if (tabId !== activeTabId) return null
      chrome.runtime.sendMessage({ type: MSG_CHAT_ACTIVITY }).catch(() => {})
      return null
    }

    case MSG_GET_STATE: {
      const settings = await getSettings()
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      const tabId = tab?.id ?? null
      let chat = tabId != null ? (chatByTab.get(tabId) ?? null) : null

      // Когда чата нет, панель должна объяснить причину, а не просто молчать:
      // «не тот сайт», «скрипт ещё не подключился к странице» и «чат не выбран» —
      // три разные ситуации с разными действиями человека.
      const onMessenger = Boolean(tab?.url?.startsWith("https://web.telegram.org/"))
      let contentAlive = Boolean(chat)
      if (!chat && onMessenger && tabId != null) {
        // Скрипт может знать чат, о котором мы забыли (сон service worker) —
        // тогда панель нарисует карточку сразу, без перезагрузки страницы.
        const probe = await pingTab(tabId)
        contentAlive = probe.alive
        chat = probe.chat
      }

      return {
        settings: { ...settings, token: settings.token ? "saved" : "" },
        configured: Boolean(settings.baseUrl && settings.token),
        chat,
        tab: { id: tabId, url: tab?.url ?? null, onMessenger, contentAlive },
      }
    }

    case MSG_RELOAD_TAB: {
      const tabId = await getActiveTabId()
      if (tabId != null) await chrome.tabs.reload(tabId)
      return null
    }

    case MSG_SAVE_SETTINGS: {
      /** @type {Partial<ExtSettings>} */
      const patch = message.settings ?? {}
      const current = await getSettings()
      const next = { ...current, ...patch }
      // Пустой токен в патче означает «не менять» — панель не показывает
      // сохранённый секрет и не может прислать его обратно.
      if (!patch.token) next.token = current.token
      if (next.baseUrl) next.baseUrl = next.baseUrl.trim().replace(/\/+$/, "")
      await chrome.storage.local.set(next)
      notifyPanel()
      return { configured: Boolean(next.baseUrl && next.token) }
    }

    case MSG_API: {
      const settings = await getSettings()
      return callApi(settings, message.action, message.payload)
    }

    case MSG_SYNC_MESSAGES: {
      return syncVisibleMessages(message.clientId)
    }

    case MSG_AI_DRAFT: {
      return buildAiDraft(message.clientId ?? null)
    }

    case MSG_INSERT_TEXT: {
      // Текст едет в поле ввода активной вкладки. Отправку не инициируем ни
      // здесь, ни в адаптере — это принцип-щит спеки, а не деталь реализации.
      const tabId = await getActiveTabId()
      if (tabId == null) return { inserted: false }
      const response = await chrome.tabs
        .sendMessage(tabId, { type: MSG_INSERT_TEXT, text: message.text })
        .catch(() => null)
      return { inserted: Boolean(response?.inserted) }
    }

    default:
      return null
  }
}

/**
 * @param {ExtSettings} settings
 * @param {string} action
 * @param {any} payload
 */
async function callApi(settings, action, payload) {
  switch (action) {
    case "resolve":
      return resolveChat(settings, payload)
    case "client-card":
      return fetchClientCard(settings, payload.clientId)
    case "quick-info":
      return fetchQuickInfo(settings, payload.clientId)
    case "templates":
      return fetchTemplates(settings, payload)
    case "bind":
      return createBinding(settings, payload)
    case "unbind":
      return deleteBinding(settings, payload)
    case "search":
      return searchClients(settings, payload.q)
    default:
      throw new Error(`Неизвестное действие: ${action}`)
  }
}

/**
 * Видимые сообщения открытого чата. null — content script не ответил
 * (вкладку закрыли, страница обновляется).
 * @param {number} tabId
 * @returns {Promise<import("../common/types.js").ChatMessage[]|null>}
 */
async function collectMessages(tabId) {
  const collected = await chrome.tabs
    .sendMessage(tabId, { type: MSG_COLLECT_MESSAGES })
    .catch(() => null)
  if (!collected) return null
  return (collected.messages ?? []).filter((m) => m.text?.trim())
}

/**
 * ИИ-черновик ответа: контекст — карточка клиента и сообщения, которые сотрудник
 * видит на экране. Возвращаем ТЕКСТ, панель кладёт его в поле ввода; отправка
 * остаётся за человеком.
 *
 * @param {string|null} clientId
 * @returns {Promise<{text: string, remaining?: number}>}
 */
async function buildAiDraft(clientId) {
  const settings = await getSettings()
  const tabId = await getActiveTabId()
  const messages = tabId != null ? ((await collectMessages(tabId)) ?? []) : []

  return fetchAiReply(settings, {
    clientId,
    // Тот же хвост, что и при заливке переписки: модели нужен разговор, а не
    // вся подгруженная история.
    messages: messages.slice(-SYNC_MESSAGES_LIMIT),
  })
}

/**
 * Забрать у content script видимые сообщения и залить их в CRM.
 *
 * Заливаем только то, что администратор видит на экране — историю не выкачиваем
 * (принцип-щит спеки: ToS мессенджеров и 152-ФЗ). Сервер идемпотентен, поэтому
 * повторные вызовы безопасны.
 *
 * @param {string} clientId
 * @returns {Promise<{created: number, skipped: number} | null>}
 */
async function syncVisibleMessages(clientId) {
  const settings = await getSettings()
  if (!settings.logMessages) return null

  const tabId = await getActiveTabId()
  if (tabId == null) return null
  const chat = await getChatForTab(tabId)
  if (!chat) return null

  // null — вкладку закрыли или content script не отвечает после обновления
  // мессенджера: панель продолжает работать без записи переписки.
  const messages = await collectMessages(tabId)
  if (!messages) return null
  if (messages.length === 0) return { created: 0, skipped: 0 }

  return syncMessages(settings, {
    clientId,
    channel: chat.channel,
    chatId: chat.chatId,
    // Только хвост: адаптер и так отдаёт последние N, но подстраховываемся —
    // заливать всю подгруженную историю в ленту коммуникаций нельзя.
    messages: messages.slice(-SYNC_MESSAGES_LIMIT),
  })
}
