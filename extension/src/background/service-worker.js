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
  MSG_API,
  MSG_CHAT_CHANGED,
  MSG_COLLECT_MESSAGES,
  MSG_GET_STATE,
  MSG_PING,
  MSG_RELOAD_TAB,
  MSG_SAVE_SETTINGS,
  MSG_STATE_CHANGED,
  MSG_SYNC_MESSAGES,
} from "../common/types.js"
import {
  ApiError,
  createBinding,
  deleteBinding,
  fetchClientCard,
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

    case MSG_GET_STATE: {
      const settings = await getSettings()
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      const tabId = tab?.id ?? null
      const chat = tabId != null ? (chatByTab.get(tabId) ?? null) : null

      // Когда чата нет, панель должна объяснить причину, а не просто молчать:
      // «не тот сайт», «скрипт ещё не подключился к странице» и «чат не выбран» —
      // три разные ситуации с разными действиями человека.
      const onMessenger = Boolean(tab?.url?.startsWith("https://web.telegram.org/"))
      let contentAlive = false
      if (!chat && onMessenger && tabId != null) {
        contentAlive = await chrome.tabs
          .sendMessage(tabId, { type: MSG_PING })
          .then((r) => Boolean(r?.alive))
          .catch(() => false)
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
  const chat = chatByTab.get(tabId)
  if (!chat) return null

  /** @type {{messages: import("../common/types.js").ChatMessage[]} | undefined} */
  let collected
  try {
    collected = await chrome.tabs.sendMessage(tabId, { type: MSG_COLLECT_MESSAGES })
  } catch {
    // Вкладку закрыли или content script не отвечает после обновления
    // мессенджера — панель продолжает работать без записи переписки.
    return null
  }

  const messages = (collected?.messages ?? []).filter((m) => m.text?.trim())
  if (messages.length === 0) return { created: 0, skipped: 0 }

  return syncMessages(settings, {
    clientId,
    channel: chat.channel,
    chatId: chat.chatId,
    messages: messages.slice(-20),
  })
}
