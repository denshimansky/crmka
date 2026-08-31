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
  createComment,
  createTask,
  fetchAiReply,
  deleteBinding,
  fetchClientCard,
  fetchQuickInfo,
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
 * Хосты, на которых работают адаптеры, — ВЫВОДИМ ИЗ МАНИФЕСТА, а не держим
 * отдельным списком.
 *
 * Раньше список был записан руками и дублировал `content_scripts.matches`.
 * Комментарий рядом честно предупреждал «почини одно — не забудь другое», но
 * проблему не решал: источников правды было четыре (matches у content_scripts,
 * matches у web_accessible_resources и два списка здесь), и добавление канала
 * означало четыре синхронных правки. Промах был бы тихим: панель показывала бы
 * «откройте web.telegram.org» поверх открытого чата второго мессенджера, потому
 * что MSG_GET_STATE вычищает из памяти чат вкладки, которую не считает
 * мессенджером.
 *
 * @returns {string[]} match-паттерны вида «https://web.max.ru/*»
 */
function messengerOrigins() {
  const scripts = chrome.runtime.getManifest().content_scripts ?? []
  const origins = new Set()
  for (const entry of scripts) {
    for (const pattern of entry.matches ?? []) {
      // «https://web.telegram.org/*» → «https://web.telegram.org/»: для сверки
      // конкретного URL вкладки match-паттерн со звёздочкой не годится.
      const origin = pattern.replace(/\*$/, "")
      if (origin.startsWith("http")) origins.add(origin)
    }
  }
  return [...origins]
}

/** @param {string|undefined} url */
function isMessengerUrl(url) {
  return Boolean(url && messengerOrigins().some((origin) => url.startsWith(origin)))
}

/**
 * Content script штатно попадает только в те вкладки, которые загрузились ПОСЛЕ
 * установки расширения. Если Telegram был открыт заранее (обычный случай:
 * поставил расширение — вкладка уже висит), панель не узнает про открытый чат,
 * пока человек не нажмёт F5. Поэтому при установке и при старте браузера
 * доинжектируем скрипт в уже открытые вкладки сами.
 */
async function injectIntoOpenTabs() {
  const scripts = chrome.runtime.getManifest().content_scripts ?? []
  // Циклы именно в таком порядке — сначала записи манифеста, потом их вкладки.
  //
  // Раньше было наоборот: брали все вкладки мессенджеров и внедряли в каждую
  // КАЖДУЮ запись content_scripts, без сверки с её matches. Браузер при штатной
  // загрузке страницы сверяет matches сам, а тут мы внедряем вручную — и с
  // появлением второго адаптера telegram.js поехал бы на web.max.ru, а max.js в
  // Telegram. Два адаптера в одном изолированном мире отвечают на один и тот же
  // ping и collect-messages, причём отвечает тот, кто успел первым, — значит в
  // карточку клиента могла бы уехать переписка не из того мессенджера.
  //
  // Свой разбор match-паттернов не пишем: chrome.tabs.query умеет их сам, и
  // его правила по определению совпадают с теми, по которым браузер внедряет
  // скрипты штатно.
  for (const entry of scripts) {
    if (!entry.matches?.length || !entry.js?.length) continue
    let tabs = []
    try {
      tabs = await chrome.tabs.query({ url: entry.matches })
    } catch {
      // Паттерн, который query не понимает, — пропускаем эту запись целиком.
      continue
    }
    for (const tab of tabs) {
      if (tab.id == null) continue
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: entry.js })
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

/**
 * Активная вкладка окна, которому принадлежит панель.
 *
 * windowId важен: боковая панель своя в КАЖДОМ окне браузера, а
 * lastFocusedWindow отдаёт вкладку того окна, что сейчас в фокусе. Без привязки
 * панель окна A управляла вкладкой окна B — вставляла туда текст и забирала
 * оттуда переписку. Панель передаёт свой windowId со всеми сообщениями;
 * его отсутствие = старое поведение, чтобы ничего не отвалилось молча.
 *
 * @param {number|null|undefined} windowId
 */
async function getActiveTab(windowId) {
  const [tab] = await chrome.tabs.query(
    windowId != null ? { active: true, windowId } : { active: true, lastFocusedWindow: true },
  )
  return tab ?? null
}

/** @param {number|null|undefined} windowId */
async function getActiveTabId(windowId) {
  const tab = await getActiveTab(windowId)
  return tab?.id ?? null
}

/**
 * Ключ чата для сравнения «тот же диалог или уже другой».
 *
 * КАНАЛ обязателен: голого chatId мало. У Telegram он бывает числовым, у MAX
 * числовой всегда — и как только каналов станет больше одного, два разных
 * диалога в двух вкладках одного окна смогут дать одинаковый chatId. Тогда
 * гард ниже пропустил бы чужую переписку как «тот же чат».
 *
 * @param {{channel: string, chatId: string}|null|undefined} chat
 * @returns {string|null}
 */
function chatKey(chat) {
  return chat ? `${chat.channel}:${chat.chatId}` : null
}

/**
 * Тот ли чат всё ещё открыт во вкладке.
 *
 * Панель принимает решение («залить переписку клиенту X», «вставить черновик»)
 * до похода на сервер, а исполняется оно через секунды — за это время человек
 * успевает переключить диалог. Промах здесь необратим: ключ дедупа не даёт
 * переписать чужие сообщения в карточке, их пришлось бы чистить в БД руками.
 *
 * @param {number} tabId
 * @param {string|null} expectedChatKey «канал:id» ожидаемого чата. null =
 *   панель не сказала, чего ждёт: не блокируем, иначе старый вызов молча
 *   перестал бы работать.
 */
async function chatMatches(tabId, expectedChatKey) {
  if (!expectedChatKey) return true
  const chat = await getChatForTab(tabId)
  return chatKey(chat) === expectedChatKey
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

// Вкладку увели с мессенджера (открыли в ней другой сайт) — чат из памяти надо
// выбросить. Раньше chatByTab чистился только при ЗАКРЫТИИ вкладки, и панель
// продолжала показывать карточку клиента поверх постороннего сайта.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url || isMessengerUrl(changeInfo.url)) return
  if (chatByTab.delete(tabId)) notifyPanel()
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
      // Сверяем внутри окна отправителя: в другом окне своя панель и свой чат.
      const activeTabId = await getActiveTabId(sender.tab?.windowId)
      if (tabId !== activeTabId) return null
      // Окно прикладываем: сообщение получат панели ВСЕХ окон, а заливать
      // переписку должна только та, чьё окно этот чат и показывает.
      chrome.runtime
        .sendMessage({ type: MSG_CHAT_ACTIVITY, windowId: sender.tab?.windowId })
        .catch(() => {})
      return null
    }

    case MSG_GET_STATE: {
      const settings = await getSettings()
      const tab = await getActiveTab(message.windowId)
      const tabId = tab?.id ?? null

      // Когда чата нет, панель должна объяснить причину, а не просто молчать:
      // «не тот сайт», «скрипт ещё не подключился к странице» и «чат не выбран» —
      // три разные ситуации с разными действиями человека.
      const onMessenger = isMessengerUrl(tab?.url)
      // Вкладка уже не на мессенджере — её чат недействителен, даже если он
      // остался в памяти (страховка на случай, если onUpdated не сработал).
      if (tabId != null && !onMessenger) chatByTab.delete(tabId)

      let chat = tabId != null && onMessenger ? (chatByTab.get(tabId) ?? null) : null
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
      const tabId = await getActiveTabId(message.windowId)
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
      return syncVisibleMessages(message.clientId, message.chatKey ?? null, message.windowId)
    }

    case MSG_AI_DRAFT: {
      return buildAiDraft(message.clientId ?? null, message.chatKey ?? null, message.windowId)
    }

    case MSG_INSERT_TEXT: {
      // Текст едет в поле ввода активной вкладки. Отправку не инициируем ни
      // здесь, ни в адаптере — это принцип-щит спеки, а не деталь реализации.
      const tabId = await getActiveTabId(message.windowId)
      if (tabId == null) return { inserted: false }
      // Пока готовился текст (ИИ-черновик — это секунды), человек мог открыть
      // другой диалог. Ответ про одного клиента в переписке с другим — хуже,
      // чем несработавшая вставка: панель отдаст текст через буфер обмена.
      if (!(await chatMatches(tabId, message.chatKey ?? null))) {
        return { inserted: false, reason: "chat-changed" }
      }
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
    case "task":
      return createTask(settings, payload)
    case "comment":
      return createComment(settings, payload)
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
 * @param {string|null} expectedChatKey Чат («канал:id»), для которого черновик заказывали.
 * @param {number|null|undefined} windowId Окно панели.
 * @returns {Promise<{text: string, remaining?: number}>}
 */
async function buildAiDraft(clientId, expectedChatKey, windowId) {
  const settings = await getSettings()
  // Черновик отправляет текст чата на сервер и дальше провайдеру ИИ — это тот
  // же поток персональных данных, что и запись переписки, и он обязан жить под
  // тем же согласием. Раньше кнопка работала при выключенном тумблере, то есть
  // расширение делало ровно то, что в интерфейсе обещало не делать.
  if (!settings.logMessages) {
    throw new Error(
      "Черновик читает переписку — включите «Записывать переписку» в настройках панели",
    )
  }
  const tabId = await getActiveTabId(windowId)
  if (tabId != null && !(await chatMatches(tabId, expectedChatKey))) {
    throw new Error("Чат сменился — откройте нужный диалог и повторите")
  }
  // Черновик отправляет переписку провайдеру ИИ — для группового чата это тот
  // же поток чужих персональных данных, что и заливка, и живёт под тем же
  // запретом. Панель до сюда не доведёт (карточки у группы нет), но гард
  // дешевле, чем доверие к панели: её сборка в браузере может быть старой.
  if (tabId != null && (await getChatForTab(tabId))?.unsupported) {
    throw new Error("Групповой чат — панель работает только с личной перепиской")
  }
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
 * @param {string|null} expectedChatKey Чат («канал:id»), чью переписку заказывала панель.
 * @param {number|null|undefined} windowId Окно панели.
 * @returns {Promise<{created: number, skipped: number} | null>}
 */
async function syncVisibleMessages(clientId, expectedChatKey, windowId) {
  const settings = await getSettings()
  if (!settings.logMessages) return null

  const tabId = await getActiveTabId(windowId)
  if (tabId == null) return null
  const chat = await getChatForTab(tabId)
  if (!chat) return null
  // Групповой чат (сегодня это MAX): панель его не обслуживает, и заливать
  // групповую переписку в карточку одного человека нельзя — убрать её оттуда
  // потом нечем. Второй из четырёх рубежей: первый в адаптере, третий в панели,
  // четвёртый на сервере. Серверный переживает старую сборку расширения в
  // браузере сотрудника, этот — старую панель.
  if (chat.unsupported) return null
  // Человек успел переключить диалог, пока панель решала. Сообщения чужого
  // чата, попавшие в карточку, оттуда уже не убрать штатно — ключ дедупа не
  // позволит их переписать.
  if (expectedChatKey && chatKey(chat) !== expectedChatKey) return null

  // null — вкладку закрыли или content script не отвечает после обновления
  // мессенджера: панель продолжает работать без записи переписки.
  const messages = await collectMessages(tabId)
  if (!messages) return null
  if (messages.length === 0) return { created: 0, skipped: 0 }

  return syncMessages(settings, {
    clientId,
    channel: chat.channel,
    chatId: chat.chatId,
    // Весь набор идентификаторов чата: по нему сервер находит уже залитую из
    // ДРУГОГО клиента Telegram переписку и не заводит её второй раз.
    altIds: chat.altIds ?? [],
    // Только хвост: адаптер и так отдаёт последние N, но подстраховываемся —
    // заливать всю подгруженную историю в ленту коммуникаций нельзя.
    messages: messages.slice(-SYNC_MESSAGES_LIMIT),
  })
}
