/**
 * Side panel — единственный видимый кусок расширения.
 *
 * Сама панель в API не ходит: все запросы идёт через service worker (там токен
 * и host_permissions). Здесь только состояние экрана и отрисовка.
 */

import {
  MSG_AI_DRAFT,
  MSG_API,
  MSG_CHAT_ACTIVITY,
  MSG_GET_STATE,
  MSG_INSERT_TEXT,
  MSG_RELOAD_TAB,
  MSG_SAVE_SETTINGS,
  MSG_STATE_CHANGED,
  MSG_SYNC_MESSAGES,
} from "../common/types.js"

/**
 * Как часто панель обновляется сама.
 *
 * ACTIVITY_THROTTLE_MS — реакция на новое сообщение в чате. Мгновенно бежать в
 * CRM на каждое движение DOM нельзя: Telegram шлёт события пачками.
 * AUTO_REFRESH_MS — фоновая перепроверка карточки: оплату или отметку занятия
 * сделали в CRM, а не в чате, и сигнала оттуда не будет.
 */
const ACTIVITY_THROTTLE_MS = 3000
const AUTO_REFRESH_MS = 60_000

/** @typedef {import("../common/types.js").ChatContext} ChatContext */
/** @typedef {import("../common/types.js").ResolveResult} ResolveResult */

const el = {
  refresh: /** @type {HTMLButtonElement} */ (document.getElementById("refresh")),
  settingsToggle: /** @type {HTMLButtonElement} */ (document.getElementById("settings-toggle")),
  setup: /** @type {HTMLElement} */ (document.getElementById("setup")),
  main: /** @type {HTMLElement} */ (document.getElementById("main")),
  baseUrl: /** @type {HTMLInputElement} */ (document.getElementById("base-url")),
  token: /** @type {HTMLInputElement} */ (document.getElementById("token")),
  logMessages: /** @type {HTMLInputElement} */ (document.getElementById("log-messages")),
  setupBack: /** @type {HTMLButtonElement} */ (document.getElementById("setup-back")),
  saveSettings: /** @type {HTMLButtonElement} */ (document.getElementById("save-settings")),
  setupError: /** @type {HTMLElement} */ (document.getElementById("setup-error")),
  status: /** @type {HTMLElement} */ (document.getElementById("status")),
  unmatched: /** @type {HTMLElement} */ (document.getElementById("unmatched")),
  unmatchedTitle: /** @type {HTMLElement} */ (document.getElementById("unmatched-title")),
  candidates: /** @type {HTMLElement} */ (document.getElementById("candidates")),
  chatDiag: /** @type {HTMLElement} */ (document.getElementById("chat-diag")),
  searchInput: /** @type {HTMLInputElement} */ (document.getElementById("search-input")),
  searchResults: /** @type {HTMLElement} */ (document.getElementById("search-results")),
  noChat: /** @type {HTMLElement} */ (document.getElementById("no-chat")),
  noChatHint: /** @type {HTMLElement} */ (document.getElementById("no-chat-hint")),
  reloadTab: /** @type {HTMLButtonElement} */ (document.getElementById("reload-tab")),
  card: /** @type {HTMLElement} */ (document.getElementById("card")),
  clientName: /** @type {HTMLAnchorElement} */ (document.getElementById("client-name")),
  clientMeta: /** @type {HTMLElement} */ (document.getElementById("client-meta")),
  unbind: /** @type {HTMLButtonElement} */ (document.getElementById("unbind")),
  balance: /** @type {HTMLElement} */ (document.getElementById("balance")),
  quick: /** @type {HTMLElement} */ (document.getElementById("quick")),
  quickButtons: /** @type {HTMLElement} */ (document.getElementById("quick-buttons")),
  aiDraft: /** @type {HTMLButtonElement} */ (document.getElementById("ai-draft")),
  actionTask: /** @type {HTMLButtonElement} */ (document.getElementById("action-task")),
  actionNote: /** @type {HTMLButtonElement} */ (document.getElementById("action-note")),
  actionForm: /** @type {HTMLElement} */ (document.getElementById("action-form")),
  actionText: /** @type {HTMLTextAreaElement} */ (document.getElementById("action-text")),
  actionDueRow: /** @type {HTMLElement} */ (document.getElementById("action-due-row")),
  actionDue: /** @type {HTMLInputElement} */ (document.getElementById("action-due")),
  actionDuePick: /** @type {HTMLButtonElement} */ (document.getElementById("action-due-pick")),
  dueCalendar: /** @type {HTMLElement} */ (document.getElementById("due-calendar")),
  calTitle: /** @type {HTMLElement} */ (document.getElementById("cal-title")),
  calGrid: /** @type {HTMLElement} */ (document.getElementById("cal-grid")),
  calPrev: /** @type {HTMLButtonElement} */ (document.getElementById("cal-prev")),
  calNext: /** @type {HTMLButtonElement} */ (document.getElementById("cal-next")),
  actionCancel: /** @type {HTMLButtonElement} */ (document.getElementById("action-cancel")),
  actionSave: /** @type {HTMLButtonElement} */ (document.getElementById("action-save")),
  wards: /** @type {HTMLElement} */ (document.getElementById("wards")),
  subscriptions: /** @type {HTMLElement} */ (document.getElementById("subscriptions")),
  payments: /** @type {HTMLElement} */ (document.getElementById("payments")),
  communications: /** @type {HTMLElement} */ (document.getElementById("communications")),
}

const state = {
  /** @type {ChatContext|null} */
  chat: null,
  /** @type {string|null} */
  clientId: null,
  baseUrl: "",
  showSetup: false,
  /** @type {{id: number|null, url: string|null, onMessenger: boolean, contentAlive: boolean}|null} */
  tab: null,
  /** Идёт ручное обновление — второй клик по ⟳ игнорируем. */
  refreshing: false,
  /** Включена ли запись переписки: под тем же согласием живёт ИИ-черновик. */
  logMessages: false,
  /**
   * Чат, из которого отрезолвился показанный клиент. Не то же самое, что
   * открытый сейчас: между ними и живут все гонки.
   *
   * Ключ КАНАЛО-КВАЛИФИЦИРОВАННЫЙ («telegram:masha»), а не голый chatId:
   * идентификаторы у разных мессенджеров бывают числовыми и с появлением
   * второго канала могут совпасть между вкладками одного окна. Цена промаха
   * необратима — чужая переписка или черновик в карточке, а ключ дедупа не
   * даёт их переписать.
   * @type {string|null}
   */
  clientChatKey: null,
}

/**
 * Окно, которому принадлежит эта панель.
 *
 * Боковая панель своя в каждом окне браузера, а service worker без подсказки
 * берёт вкладку окна «в фокусе» — и панель одного окна начинала управлять
 * вкладкой другого. Узнаём своё окно один раз при старте и прикладываем ко
 * всем сообщениям.
 * @type {number|null}
 */
let panelWindowId = null

/** Ключ чата для сравнения «тот же диалог или уже другой». */
function chatKey(chat) {
  return chat ? `${chat.channel}:${chat.chatId}` : null
}

/**
 * Номер текущей отрисовки.
 *
 * renderForChat ходит на сервер дважды (resolve → client-card), а поводов
 * перерисоваться много: смена чата, переключение вкладки, сигнал активности.
 * Без номера ответы приходят вперемешку, и последним на экран мог лечь клиент
 * ПРЕДЫДУЩЕГО чата — а следом за ним уходила заливка переписки уже открытого,
 * то есть чужие сообщения оседали в чужой карточке навсегда.
 */
let renderSeq = 0

/**
 * Ключ того, ЧТО должно быть на экране: либо открытый чат, либо причина, по
 * которой его нет. Причин три, у каждой своя подсказка и своё действие
 * человека — без них панель оставила бы совет от прошлой ситуации.
 * @param {ChatContext|null} chat
 * @param {{onMessenger: boolean, contentAlive: boolean}|null} tab
 */
function screenKey(chat, tab) {
  if (chat) return chatKey(chat)
  if (!tab?.onMessenger) return "нет-чата:не-мессенджер"
  if (!tab.contentAlive) return "нет-чата:скрипт-не-подключён"
  return "нет-чата:диалог-не-выбран"
}

/**
 * Что сейчас НАРИСОВАНО на экране (см. screenKey).
 *
 * Это не то же самое, что `state.chat`: состояние обновляется на каждом
 * `loadState`, в том числе пока открыты настройки и экран вообще не трогается.
 * Сравнивать «то же ли самое» надо именно с нарисованным, иначе панель считает
 * экран актуальным там, где он устарел. `undefined` — ещё ни разу не рисовали.
 * @type {string|null|undefined}
 */
let renderedScreenKey = undefined

/**
 * Запрос к service worker. Он отвечает конвертом {ok, result|error}, чтобы
 * ошибка API не превращалась в необработанный reject в панели.
 * @param {any} message
 * @returns {Promise<any>}
 */
async function send(message) {
  const response = await chrome.runtime.sendMessage(
    panelWindowId == null ? message : { ...message, windowId: panelWindowId },
  )
  if (!response?.ok) throw new Error(response?.error || "Нет связи с расширением")
  return response.result
}

/** @param {string} action @param {any} [payload] */
function api(action, payload) {
  return send({ type: MSG_API, action, payload })
}

/** Экранирование: имена и тексты сообщений приходят от людей и из мессенджера. */
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  )
}

/**
 * Символ валюты организации. Приходит с карточкой (суммы по курсу никто не
 * пересчитывает, меняется только символ); до первой карточки — рубль.
 */
let currencySign = "₽"

/** @param {number} value */
function money(value) {
  return (
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + " " + currencySign
  )
}

/** «2026-08-29» → «29.08» */
function shortDate(iso) {
  if (!iso) return ""
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}.${m}${y === String(new Date().getFullYear()) ? "" : "." + y}`
}

/** ISO-время → «27.08 13:15» */
function shortDateTime(iso) {
  if (!iso) return ""
  const date = new Date(iso)
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function showStatus(text) {
  el.status.textContent = text
  el.status.hidden = !text
}

// ─── Настройки ───

/**
 * @param {{force?: boolean}} [options] force — полное перечитывание (кнопка ⟳).
 */
async function loadState(options = {}) {
  const data = await send({ type: MSG_GET_STATE })
  state.chat = data.chat
  state.tab = data.tab ?? null
  state.baseUrl = data.settings.baseUrl
  renderChatDiag()
  state.logMessages = Boolean(data.settings.logMessages)
  el.baseUrl.value = data.settings.baseUrl
  el.logMessages.checked = data.settings.logMessages
  // Токен не показываем: в хранилище он есть, но панель его не получает.
  el.token.placeholder = data.configured ? "сохранён — введите новый, чтобы заменить" : "crmka_…"

  if (!data.configured || state.showSetup) {
    el.setup.hidden = false
    el.main.hidden = true
    // Возвращаться некуда, пока расширение не подключено: главный экран пуст.
    el.setupBack.hidden = !data.configured
    return
  }
  el.setup.hidden = true
  el.main.hidden = false

  // Панель перечитывает состояние на КАЖДОЕ переключение вкладки браузера
  // (tabs.onActivated) и на каждый сигнал от service worker, а renderForChat
  // ходит на сервер и пересобирает экран. Пока на экране уже нарисован ровно
  // этот чат — не трогаем его.
  const unchanged =
    renderedScreenKey !== undefined && screenKey(state.chat, state.tab) === renderedScreenKey
  if (!options.force && unchanged) return

  await renderForChat()
}

/**
 * loadState, который никогда не оставляет панель белой.
 *
 * Оба экрана в разметке скрыты, и любая ошибка по пути (service worker ещё не
 * поднялся, связь оборвалась) раньше давала пустой прямоугольник без единой
 * подсказки — даже #status невидим, он внутри скрытого #main.
 * @param {{force?: boolean}} [options]
 */
async function safeLoadState(options) {
  try {
    await loadState(options)
  } catch (error) {
    el.setup.hidden = true
    el.main.hidden = false
    el.card.hidden = true
    el.unmatched.hidden = true
    el.noChat.hidden = true
    showStatus(
      (error instanceof Error ? error.message : "Не удалось получить состояние") +
        " — нажмите ⟳ в шапке",
    )
  }
}

el.settingsToggle.addEventListener("click", () => {
  state.showSetup = !state.showSetup
  void safeLoadState()
})

// Уход с настроек без сохранения: набранное в полях просто забываем — в
// хранилище оно и не попадало.
el.setupBack.addEventListener("click", () => {
  el.token.value = ""
  el.setupError.hidden = true
  state.showSetup = false
  void safeLoadState()
})

el.saveSettings.addEventListener("click", async () => {
  el.setupError.hidden = true
  el.saveSettings.disabled = true
  try {
    await send({
      type: MSG_SAVE_SETTINGS,
      settings: {
        baseUrl: el.baseUrl.value.trim(),
        token: el.token.value.trim(),
        logMessages: el.logMessages.checked,
      },
    })
    el.token.value = ""
    state.showSetup = false
    // force: сменились адрес CRM или токен — карточка, ссылка на клиента и
    // сам clientId добыты прежними настройками и больше не годятся. Без этого
    // панель оставалась на карточке со старого сервера, а задача из неё уходила
    // на новый сервер со старым id (базы dev и прод — клоны с теми же UUID).
    await loadState({ force: true })
  } catch (error) {
    el.setupError.textContent = error instanceof Error ? error.message : "Не удалось сохранить"
    el.setupError.hidden = false
  } finally {
    el.saveSettings.disabled = false
  }
})

// ─── Основной экран ───

async function renderForChat() {
  // Снимок чата: дальше два похода на сервер, и `state.chat` за это время
  // меняется. Всё, что рисуем и чем потом пользуемся, должно относиться к
  // ОДНОМУ диалогу — тому, с которого начали.
  const chat = state.chat
  const seq = ++renderSeq
  renderedScreenKey = screenKey(chat, state.tab)

  el.card.hidden = true
  el.unmatched.hidden = true
  el.noChat.hidden = true
  el.reloadTab.hidden = true
  el.quick.hidden = true
  // Недописанную задачу или комментарий сохраняем: перерисовок много (смена
  // вкладки, уход с мессенджера, фоновые сигналы), и терять набранное нельзя.
  actionDraft = captureActionDraft()
  closeAction({ keepDraft: true })
  state.clientId = null
  state.clientChatKey = null
  // Поиск: гасим отложенный запрос и обесцениваем висящие ответы, иначе выдача
  // по прошлому чату дорисовывалась в новый и привязывала не тот диалог.
  clearTimeout(searchTimer)
  searchSeq++
  // Справку перечитываем заново: сменился чат — сменился и клиент, а по ⟳
  // человек как раз и ждёт свежие данные.
  quickInfoFor = null

  if (!chat) {
    showNoChatReason()
    return
  }

  showStatus("Ищем клиента…")
  /** @type {ResolveResult} */
  let resolved
  try {
    resolved = await api("resolve", {
      channel: chat.channel,
      chatId: chat.chatId,
      // Без altIds сервер видит только идентификатор из адресной строки:
      // привязка, сделанная в другом клиенте Telegram, не находится, канон
      // не достраивается и конфликт не определяется. Это ГЛАВНЫЙ путь.
      altIds: chat.altIds,
      phone: chat.phone,
    })
  } catch (error) {
    if (seq !== renderSeq) return
    showStatus(error instanceof Error ? error.message : "Ошибка запроса")
    return
  }
  // Пока искали клиента, человек открыл другой чат — эта отрисовка устарела.
  if (seq !== renderSeq) return

  if (resolved.clientId) {
    await showClient(resolved.clientId, { seq, chatKey: chatKey(chat) })
    return
  }

  showStatus("")
  el.unmatched.hidden = false
  el.candidates.innerHTML = ""
  el.searchResults.innerHTML = ""
  el.searchInput.value = ""

  // «@» ставим только у ника: у числового id «@987654321» читается как
  // несуществующий ник и сбивает с толку.
  const who = chat.title
    ? `«${chat.title}»`
    : /^-?\d+$/.test(chat.chatId)
      ? chat.chatId
      : `@${chat.chatId}`
  // Ответ сервера читаем оборонительно: подсказок может не быть вовсе, а
  // исключение здесь оставило бы панель без единого объяснения.
  const candidates = resolved?.candidates ?? []
  if (resolved?.match === "conflict") {
    // Идентификаторы одного чата ведут к РАЗНЫМ клиентам. Сшивать молча
    // нельзя: ошибка необратима, переписка осядет в чужой карточке. Решает
    // человек, и до его выбора мы ничего не заливаем.
    el.unmatchedTitle.textContent = `Чат ${who} привязан к разным клиентам — выберите верного, остальные привязки исправятся.`
    renderCandidates(el.candidates, candidates)
  } else if (candidates.length > 0) {
    el.unmatchedTitle.textContent = `Кого из клиентов означает чат ${who}?`
    renderCandidates(el.candidates, candidates)
  } else {
    el.unmatchedTitle.textContent = `Чат ${who} пока не связан с клиентом. Найдите его — связь запомнится.`
  }
}

/**
 * Строка диагностики на экране настроек: какой чат видит адаптер и удалось ли
 * определить канонический идентификатор собеседника.
 *
 * Нужна не для красоты: поломка селекторов Telegram молчалива по устройству —
 * канон не прочитался, расширение тихо вернулось к прежнему поведению, и без
 * этой строки мы узнали бы о поломке через месяц по новым дублям в карточках.
 */
function renderChatDiag() {
  const chat = state.chat
  if (!chat) {
    el.chatDiag.textContent = ""
    return
  }
  const ids = chat.altIds?.length ? chat.altIds.join(", ") : chat.chatId
  el.chatDiag.textContent = `Чат: ${ids}` + (chat.peerSource ? ` · канон: ${chat.peerSource}` : "")
}

/**
 * Почему панель не показывает клиента. Три разные причины требуют трёх разных
 * действий человека, поэтому не отделываемся общим «откройте чат».
 */
function showNoChatReason() {
  showStatus("")
  el.noChat.hidden = false
  const tab = state.tab

  if (!tab?.onMessenger) {
    el.noChatHint.textContent =
      "Панель работает поверх веб-мессенджера. Откройте в этой вкладке web.telegram.org и вернитесь сюда."
    return
  }

  if (!tab.contentAlive) {
    // Обычный случай сразу после установки: вкладка Telegram была открыта
    // раньше расширения, и в неё не попал наш скрипт.
    el.noChatHint.textContent =
      "Расширение ещё не подключилось к этой странице — так бывает, если вкладка была открыта до установки. Обновите её."
    el.reloadTab.hidden = false
    return
  }

  el.noChatHint.textContent =
    "Откройте слева чат с родителем — покажу карточку клиента. Если чат открыт, а карточки нет, обновите вкладку."
  el.reloadTab.hidden = false
}

el.reloadTab.addEventListener("click", async () => {
  el.reloadTab.disabled = true
  try {
    await send({ type: MSG_RELOAD_TAB })
    // Страница перезагружается, content script сообщит о чате сам — панель
    // получит state-changed. Даём немного времени и перечитываем состояние.
    setTimeout(() => {
      el.reloadTab.disabled = false
      void safeLoadState()
    }, 1500)
  } catch {
    el.reloadTab.disabled = false
  }
})

/**
 * @param {HTMLElement} container
 * @param {Array<{id: string, name: string, phone: string|null, stateLabel?: string}>} items
 */
function renderCandidates(container, items) {
  container.innerHTML = items
    .map(
      (c) => `
      <button class="candidate" type="button" data-client-id="${escapeHtml(c.id)}">
        <span>${escapeHtml(c.name)}</span>
        <span class="muted">${escapeHtml([c.phone, c.stateLabel].filter(Boolean).join(" · "))}</span>
      </button>`,
    )
    .join("")

  for (const button of container.querySelectorAll("[data-client-id]")) {
    button.addEventListener("click", () => {
      const clientId = /** @type {HTMLElement} */ (button).dataset.clientId
      if (clientId) void bindTo(clientId)
    })
  }
}

/** Привязать текущий чат к клиенту и показать карточку. */
async function bindTo(clientId) {
  // Снимок: пока идёт запрос, человек может открыть другой диалог, и карточка
  // привязалась бы к одному чату, а показалась в другом.
  const chat = state.chat
  if (!chat) return
  const seq = renderSeq
  showStatus("Связываем…")
  try {
    await api("bind", {
      channel: chat.channel,
      chatId: chat.chatId,
      // Весь набор: сервер запомнит чат под каждым из идентификаторов, и
      // привязка, сделанная в /k, найдётся в /a — там @username в разметке
      // нет вовсе, поэтому связать их можно только отсюда.
      altIds: chat.altIds,
      clientId,
      displayName: chat.title,
      saveHandle: true,
    })
    if (seq !== renderSeq) return
    el.unmatched.hidden = true
    await showClient(clientId, { seq, chatKey: chatKey(chat) })
  } catch (error) {
    if (seq !== renderSeq) return
    showStatus(error instanceof Error ? error.message : "Не удалось связать")
  }
}

el.unbind.addEventListener("click", async () => {
  if (!state.chat) return
  showStatus("Отвязываем…")
  try {
    // altIds обязателен: без него отвязка в /a снимала бы только числовую
    // строку, а привязка по @username из /k оставалась бы жить.
    await api("unbind", {
      channel: state.chat.channel,
      chatId: state.chat.chatId,
      altIds: state.chat.altIds,
    })
    await renderForChat()
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Не удалось отвязать")
  }
})

/** Поиск клиента для ручной привязки. */
let searchTimer
/** Номер последнего отправленного запроса поиска. */
let searchSeq = 0
el.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer)
  const query = el.searchInput.value.trim()
  if (query.length < 2) {
    searchSeq++
    el.searchResults.innerHTML = ""
    return
  }
  searchTimer = setTimeout(async () => {
    // Ответы приходят не в том порядке, в каком уходили запросы: без счётчика
    // выдача по короткому запросу перекрывала выдачу по уточнённому, и человек
    // видел «не тех» клиентов, дописав второе слово.
    const seq = ++searchSeq
    try {
      const data = await api("search", { q: query })
      if (seq !== searchSeq) return
      renderCandidates(el.searchResults, data.clients ?? [])
    } catch (error) {
      if (seq !== searchSeq) return
      el.searchResults.innerHTML = `<p class="error">${escapeHtml(
        error instanceof Error ? error.message : "Ошибка поиска",
      )}</p>`
    }
  }, 300)
})

/**
 * @param {string} clientId
 * @param {{silent?: boolean, seq?: number, chatKey?: string|null}} [options]
 *   silent — фоновое обновление: не мигаем статусом «Загружаем карточку…» и
 *   молча переживаем ошибку сети. seq — номер отрисовки, из которой пришли.
 *   chatKey — чат, из которого этот клиент отрезолвился («канал:id»).
 */
async function showClient(clientId, options = {}) {
  const silent = options.silent === true
  const seq = options.seq ?? renderSeq
  if (!silent) showStatus("Загружаем карточку…")
  let card
  try {
    card = await api("client-card", { clientId })
  } catch (error) {
    if (seq !== renderSeq) return
    if (!silent) showStatus(error instanceof Error ? error.message : "Не удалось загрузить карточку")
    return
  }

  // Пока ходили за карточкой, человек мог переключить чат — чужую не рисуем.
  if (seq !== renderSeq) return
  if (silent && state.clientId !== clientId) return

  state.clientId = clientId
  if (options.chatKey !== undefined) state.clientChatKey = options.chatKey
  if (!silent) showStatus("")
  el.unmatched.hidden = true
  el.card.hidden = false
  renderCard(card)
  if (!silent) restoreActionDraft(clientId)

  // Переписку заливаем в фоне: она не должна задерживать показ карточки, а
  // сервер всё равно пропустит уже известные сообщения. При фоновом
  // обновлении (раз в минуту) не заливаем: новые сообщения и так приносит
  // сигнал активности, а так каждый открытый чат гнал на сервер батч в минуту.
  if (!silent) void syncMessagesAndRefresh(clientId)
  // Справка — отдельным запросом и только при смене клиента (см. quickInfoFor).
  void loadQuickInfo(clientId)
}

/**
 * Залить увиденные сообщения и, если что-то действительно добавилось, тихо
 * перечитать карточку.
 *
 * Порядок важен: карточку мы уже показали (человек не ждёт), а новые сообщения
 * попадают в блок «Переписка и события» только после заливки. Без этого
 * последнее сообщение появлялось бы в панели лишь при следующем открытии чата —
 * ровно та жалоба, из-за которой приходилось перезагружать страницу Telegram.
 * @param {string} clientId
 */
async function syncMessagesAndRefresh(clientId) {
  // Чат берём ТОТ, ИЗ КОТОРОГО ОТРЕЗОЛВИЛСЯ ЭТОТ КЛИЕНТ, а не открытый сейчас.
  // Иначе при быстром переключении диалогов сообщения нового чата уезжали в
  // карточку прежнего клиента — навсегда: ключ дедупа не даёт их переписать.
  const expectedChatKey = state.clientChatKey
  let result
  try {
    result = await send({ type: MSG_SYNC_MESSAGES, clientId, chatKey: expectedChatKey })
  } catch {
    // Запись переписки — необязательная часть: карточка уже на экране.
    return
  }
  // null — запись переписки выключена в настройках; 0 — всё уже было в CRM.
  if (!result?.created) return
  if (state.clientId !== clientId) return

  try {
    const card = await api("client-card", { clientId })
    if (state.clientId === clientId) renderCard(card)
  } catch {
    // Молча: на экране осталась предыдущая версия карточки.
  }
}

// ─── «Вставить в чат»: справка по клиенту ───

/**
 * Для какого клиента справка уже загружена. Она меняется редко (расписание,
 * остаток, баланс), а карточка перечитывается раз в минуту — гонять сборку
 * текста на каждое фоновое обновление незачем. Сбрасывается при смене чата и
 * по кнопке ⟳.
 * @type {string|null}
 */
let quickInfoFor = null

/** @param {string} clientId */
async function loadQuickInfo(clientId) {
  if (quickInfoFor === clientId) return
  quickInfoFor = clientId
  el.quick.hidden = true
  el.quickButtons.innerHTML = ""

  let info
  try {
    info = await api("quick-info", { clientId })
  } catch {
    // Справка — вспомогательная вещь: карточка уже на экране. Дадим следующему
    // показу шанс попробовать снова.
    quickInfoFor = null
    return
  }
  if (state.clientId !== clientId) return

  renderChips(el.quickButtons, info?.blocks ?? [], "chip")
  el.aiDraft.hidden = false
  el.quick.hidden = false
}

/**
 * Кнопки вставки. Подпись — короткая (title блока или название шаблона), сам
 * текст уходит в подсказку при наведении: в узкой панели он не поместится, а
 * увидеть, что вставится, надо до клика.
 *
 * @param {HTMLElement} container
 * @param {Array<{title: string, text: string}>} items
 * @param {string} className
 */
function renderChips(container, items, className) {
  container.innerHTML = items
    .map(
      (item, index) =>
        `<button class="${className}" type="button" data-index="${index}" title="${escapeHtml(
          item.text,
        )}">${escapeHtml(item.title)}</button>`,
    )
    .join("")

  for (const node of container.querySelectorAll("[data-index]")) {
    const button = /** @type {HTMLButtonElement} */ (node)
    const item = items[Number(button.dataset.index)]
    if (!item) continue
    button.addEventListener(
      "click",
      () => void insertIntoChat(item.text, button, state.clientChatKey),
    )
  }
}

/**
 * Вставить текст в поле ввода мессенджера. Именно вставить: отправляет человек.
 * @param {string} text
 * @param {HTMLButtonElement} button
 * @param {string|null} [expectedChatKey] Чат («канал:id»), для которого текст
 *   готовили. Если человек успел открыть другой диалог — не вставляем: чужой
 *   ответ в чужой переписке хуже, чем несработавшая кнопка.
 * @returns {Promise<boolean>} удалось ли вставить в поле ввода
 */
async function insertIntoChat(text, button, expectedChatKey) {
  button.disabled = true
  try {
    const result = await send({
      type: MSG_INSERT_TEXT,
      text,
      chatKey: expectedChatKey ?? state.clientChatKey,
    })
    if (result?.inserted) {
      flashStatus("Текст вставлен в поле ввода — проверьте и отправьте")
      return true
    }
    // Поле ввода не нашли (чат закрыт, непривычная вёрстка) либо диалог уже
    // сменился — отдаём текст через буфер обмена, чтобы он не пропал.
    const chatChanged = result?.reason === "chat-changed"
    try {
      await navigator.clipboard.writeText(text)
      flashStatus(
        chatChanged
          ? "Чат сменился — текст скопирован, вставьте в нужный диалог"
          : "Поле ввода не найдено — текст скопирован, вставьте вручную",
      )
    } catch {
      flashStatus("Не удалось вставить текст")
    }
    return false
  } catch {
    flashStatus("Не удалось вставить текст")
    return false
  } finally {
    button.disabled = false
  }
}

/**
 * ИИ-черновик ответа.
 *
 * Занимает несколько секунд, поэтому кнопка блокируется и честно пишет, что
 * происходит: без этого человек жмёт её повторно и тратит дневной лимит.
 * Результат попадает в поле ввода — отправляет его человек, прочитав.
 */
el.aiDraft.addEventListener("click", async () => {
  // Черновик показывает модели последние сообщения чата — это тот же поток
  // персональных данных, что и запись переписки, и он живёт под тем же
  // согласием. Ничего не отправляем и объясняем причину прямо здесь.
  if (!state.logMessages) {
    flashStatus("Черновик читает переписку — включите её запись в настройках панели")
    return
  }
  // Чат берём тот, из которого взят показанный клиент: модель отвечает
  // несколько секунд, за это время человек успевает открыть другой диалог, и
  // ответ про одного родителя не должен попасть в переписку с другим.
  const expectedChatKey = state.clientChatKey
  el.aiDraft.disabled = true
  const label = el.aiDraft.textContent
  el.aiDraft.textContent = "✨ Готовим…"
  try {
    const result = await send({ type: MSG_AI_DRAFT, clientId: state.clientId, chatKey: expectedChatKey })
    if (!result?.text) {
      flashStatus("ИИ не вернул черновик — попробуйте ещё раз")
      return
    }
    // Только по факту вставки: иначе бодрое «Черновик вставлен» затирало
    // сообщение о том, что текст ушёл в буфер обмена.
    if (await insertIntoChat(result.text, el.aiDraft, expectedChatKey)) {
      flashStatus("Черновик вставлен — прочитайте и поправьте перед отправкой")
    }
  } catch (error) {
    // Здесь ошибки осмысленные (нет доступа к ИИ, дневной лимит, релей лежит) —
    // показываем текст сервера как есть.
    flashStatus(error instanceof Error ? error.message : "Не удалось получить черновик")
  } finally {
    el.aiDraft.textContent = label
    el.aiDraft.disabled = false
  }
})

// ─── Записать в CRM: задача и комментарий ───

/** Что сейчас заполняют: "task" | "note" | null. @type {"task"|"note"|null} */
let actionKind = null

/**
 * Недописанная задача или комментарий, пережидающие перерисовку экрана.
 *
 * Панель пересобирается по многим поводам, которые человек не инициировал:
 * переключился на соседнюю вкладку браузера, ушёл с мессенджера, прилетел
 * сигнал от service worker. Каждый такой повод раньше стирал набранный текст.
 * Черновик привязан к клиенту, чтобы не переехать в чужую карточку.
 * @type {{clientId: string, kind: "task"|"note", text: string, due: string}|null}
 */
let actionDraft = null

/** Снять черновик перед перерисовкой. Пустой текст черновиком не считаем. */
function captureActionDraft() {
  if (!actionKind || !state.clientId) return null
  const text = el.actionText.value
  if (!text.trim()) return null
  return { clientId: state.clientId, kind: actionKind, text, due: el.actionDue.value }
}

/**
 * Вернуть черновик, если карточка снова того же клиента.
 * @param {string} clientId
 */
function restoreActionDraft(clientId) {
  const draft = actionDraft
  if (!draft || draft.clientId !== clientId) return
  actionDraft = null
  // Без фокуса: перерисовка чаще всего фоновая, и уводить каретку в панель,
  // пока человек печатает в мессенджере, нельзя.
  openAction(draft.kind, { focus: false })
  el.actionText.value = draft.text
  if (draft.due) {
    el.actionDue.value = draft.due
    syncDueChips()
  }
}

/**
 * Дата для поля type="date" — местная, а не UTC: иначе вечером срок задачи
 * уезжает на день вперёд.
 * @param {number} plusDays
 */
function dateInputValue(plusDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + plusDays)
  return toInputValue(date)
}

/** «2026-09-15» → «15.09.2026» — так дату читают, а не в ISO. */
function humanDate(value) {
  const [y, m, d] = value.split("-")
  return y && m && d ? `${d}.${m}.${y}` : value
}

/**
 * Подсветить кнопку срока, которая совпадает с выбранной датой, а на кнопке
 * календаря показать саму дату, если выбрана своя: иначе после выбора не видно,
 * на какой день поставлена задача.
 */
function syncDueChips() {
  let matched = false
  for (const node of el.actionDueRow.querySelectorAll("[data-due-days]")) {
    const button = /** @type {HTMLButtonElement} */ (node)
    const isCurrent = el.actionDue.value === dateInputValue(Number(button.dataset.dueDays))
    button.setAttribute("aria-pressed", String(isCurrent))
    matched = matched || isCurrent
  }
  el.actionDuePick.setAttribute("aria-pressed", String(!matched))
  el.actionDuePick.textContent =
    matched || !el.actionDue.value ? "Выбрать дату" : humanDate(el.actionDue.value)
}

// Срок ставится кнопкой: «перезвонить завтра» — самый частый случай, а
// набирать дату руками в узкой панели неудобно.
for (const node of document.querySelectorAll("[data-due-days]")) {
  const button = /** @type {HTMLButtonElement} */ (node)
  button.addEventListener("click", () => {
    el.actionDue.value = dateInputValue(Number(button.dataset.dueDays))
    // Выбрали быстрый срок — календарь больше не нужен.
    el.dueCalendar.hidden = true
    syncDueChips()
  })
}

// ─── Календарь ───
//
// Свой, а не родной: `input[type=date]` в боковой панели Chrome не открывает
// пикер ни по иконке, ни через showPicker() — кнопка просто не реагирует.
// Здесь же он красится нашей темой и одинаков в светлой и тёмной.

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

/** Первое число показываемого месяца. @type {Date|null} */
let calendarMonth = null

/** «2026-09-15» → Date в местной зоне (иначе UTC сдвинет день). */
function parseInputDate(value) {
  const [y, m, d] = value.split("-").map(Number)
  return y && m && d ? new Date(y, m - 1, d) : new Date()
}

/** Date → «2026-09-15» без сдвига зоны. */
function toInputValue(date) {
  const shifted = new Date(date)
  shifted.setMinutes(shifted.getMinutes() - shifted.getTimezoneOffset())
  return shifted.toISOString().slice(0, 10)
}

function toggleCalendar() {
  if (!el.dueCalendar.hidden) {
    el.dueCalendar.hidden = true
    return
  }
  const base = el.actionDue.value ? parseInputDate(el.actionDue.value) : new Date()
  calendarMonth = new Date(base.getFullYear(), base.getMonth(), 1)
  renderCalendar()
  el.dueCalendar.hidden = false
}

/** @param {number} delta сдвиг в месяцах */
function shiftMonth(delta) {
  if (!calendarMonth) return
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + delta, 1)
  renderCalendar()
}

function renderCalendar() {
  if (!calendarMonth) return
  el.calTitle.textContent = `${MONTHS[calendarMonth.getMonth()]} ${calendarMonth.getFullYear()}`

  const today = toInputValue(new Date())
  const selected = el.actionDue.value
  // Неделя начинается с понедельника: getDay() считает от воскресенья.
  const firstShift = (calendarMonth.getDay() + 6) % 7

  const cells = WEEKDAYS.map((day) => `<div class="cal-weekday">${day}</div>`)
  // Шесть недель фиксированно — иначе высота календаря прыгает при листании.
  for (let i = 0; i < 42; i++) {
    const date = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth(),
      i - firstShift + 1,
    )
    const value = toInputValue(date)
    const classes = ["cal-day"]
    if (date.getMonth() !== calendarMonth.getMonth()) classes.push("other")
    if (value === today) classes.push("today")
    if (value === selected) classes.push("selected")
    cells.push(
      `<button type="button" class="${classes.join(" ")}" data-date="${value}">${date.getDate()}</button>`,
    )
  }
  el.calGrid.innerHTML = cells.join("")

  for (const node of el.calGrid.querySelectorAll("[data-date]")) {
    const button = /** @type {HTMLButtonElement} */ (node)
    button.addEventListener("click", () => {
      el.actionDue.value = button.dataset.date ?? ""
      el.dueCalendar.hidden = true
      syncDueChips()
    })
  }
}

el.actionDuePick.addEventListener("click", () => toggleCalendar())
el.calPrev.addEventListener("click", () => shiftMonth(-1))
el.calNext.addEventListener("click", () => shiftMonth(1))

/**
 * @param {"task"|"note"} kind
 * @param {{focus?: boolean}} [options] focus — ставить ли каретку в поле.
 */
function openAction(kind, options = {}) {
  // Повторное нажатие по той же кнопке закрывает форму — так понятнее, чем
  // искать «Отмену» глазами.
  if (actionKind === kind) {
    closeAction()
    return
  }
  actionKind = kind
  el.actionForm.hidden = false
  el.actionDueRow.hidden = kind !== "task"
  el.actionText.placeholder =
    kind === "task" ? "Перезвонить, обсудить перенос…" : "Что записать в карточку клиента"
  el.actionDue.value = dateInputValue()
  el.dueCalendar.hidden = true
  syncDueChips()
  el.actionText.value = ""
  syncActionChips()
  if (options.focus !== false) el.actionText.focus()
}

/**
 * @param {{keepDraft?: boolean}} [options] keepDraft — форму закрывает не
 *   человек, а перерисовка: набранное сохраняем и вернём (см. actionDraft).
 */
function closeAction(options = {}) {
  actionKind = null
  el.actionForm.hidden = true
  el.dueCalendar.hidden = true
  el.actionText.value = ""
  if (!options.keepDraft) actionDraft = null
  syncActionChips()
}

/** Подсветить кнопку открытой формы — иначе не видно, что именно заполняешь. */
function syncActionChips() {
  el.actionTask.setAttribute("aria-pressed", String(actionKind === "task"))
  el.actionNote.setAttribute("aria-pressed", String(actionKind === "note"))
}

el.actionTask.addEventListener("click", () => openAction("task"))
el.actionNote.addEventListener("click", () => openAction("note"))
el.actionCancel.addEventListener("click", () => closeAction())

el.actionSave.addEventListener("click", async () => {
  const text = el.actionText.value.trim()
  const clientId = state.clientId
  if (!actionKind || !clientId) return
  if (!text) {
    flashStatus(actionKind === "task" ? "Опишите задачу" : "Напишите комментарий")
    el.actionText.focus()
    return
  }

  el.actionSave.disabled = true
  const kind = actionKind
  try {
    if (kind === "task") {
      await api("task", { clientId, title: text, dueDate: el.actionDue.value || undefined })
      flashStatus("Задача создана — она в вашем списке задач")
    } else {
      await api("comment", { clientId, text })
      flashStatus("Комментарий записан в карточку")
    }
    closeAction()
    // Комментарий попадает в ленту коммуникаций — сразу показываем его в
    // блоке «Переписка и события», не дожидаясь фонового обновления.
    if (kind === "note") void showClient(clientId, { silent: true })
  } catch (error) {
    flashStatus(error instanceof Error ? error.message : "Не удалось сохранить")
  } finally {
    el.actionSave.disabled = false
  }
})

/** Показать сообщение и убрать через несколько секунд, если его не перебили. */
function flashStatus(text) {
  showStatus(text)
  setTimeout(() => {
    if (el.status.textContent === text) showStatus("")
  }, 4000)
}

// ─── Обновление: вручную (⟳), по новому сообщению и фоном ───

/** Полное обновление по кнопке: перечитываем вкладку, чат, клиента и карточку. */
async function refreshAll() {
  if (state.refreshing) return
  state.refreshing = true
  el.refresh.disabled = true
  el.refresh.classList.add("spinning")
  try {
    // force: по ⟳ человек ждёт именно полного перечитывания, даже если чат тот же.
    await loadState({ force: true })
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Не удалось обновить")
  } finally {
    el.refresh.classList.remove("spinning")
    el.refresh.disabled = false
    state.refreshing = false
  }
}

el.refresh.addEventListener("click", () => void refreshAll())

/** @type {ReturnType<typeof setTimeout>|undefined} */
let activityTimer
let lastActivityAt = 0

/**
 * В открытом чате появилось новое сообщение. Дёргать сервер на каждое нельзя
 * (в переписке сообщения идут очередями), поэтому не чаще раза в
 * ACTIVITY_THROTTLE_MS — но обязательно с «хвостовым» запуском, иначе последнее
 * сообщение серии так и не доедет.
 */
function scheduleActivityRefresh() {
  if (!state.clientId || activityTimer) return
  const wait = Math.max(0, ACTIVITY_THROTTLE_MS - (Date.now() - lastActivityAt))
  activityTimer = setTimeout(() => {
    activityTimer = undefined
    lastActivityAt = Date.now()
    if (state.clientId) void syncMessagesAndRefresh(state.clientId)
  }, wait)
}

// Фоновая перепроверка: оплату провели в CRM, занятие отметили — в чате об
// этом сигнала нет. Когда панель скрыта, браузер и так тормозит таймеры, но
// лишний запрос из свёрнутого окна нам всё равно не нужен.
setInterval(() => {
  if (document.hidden || state.refreshing || !state.clientId) return
  void showClient(state.clientId, { silent: true })
}, AUTO_REFRESH_MS)

function renderCard(card) {
  currencySign = card.currencySymbol || "₽"
  el.clientName.textContent = card.client.name
  el.clientName.href = state.baseUrl + card.client.cardPath
  el.clientMeta.textContent = [card.client.stateLabel, card.client.branchName, card.client.phone]
    .filter(Boolean)
    .join(" · ")

  const balance = card.client.balance
  el.balance.className = "balance" + (balance < 0 ? " debt" : "")
  el.balance.textContent =
    balance < 0
      ? `Долг по балансу: ${money(-balance)}`
      : balance > 0
        ? `Баланс: ${money(balance)}`
        : `Баланс: ${money(0)}`

  el.wards.innerHTML = card.wards.length
    ? card.wards
        .map(
          (w) => `
      <div class="ward">
        <div class="ward-name">${escapeHtml(w.name)}${
          w.ageLabel ? ` <span class="muted">${escapeHtml(w.ageLabel)}</span>` : ""
        }</div>
        <div class="row"><span class="label">Было</span><span>${
          w.lastLesson
            ? escapeHtml(
                `${shortDate(w.lastLesson.date)} ${w.lastLesson.startTime} · ${
                  w.lastLesson.direction ?? ""
                } · ${w.lastLesson.mark ?? ""}`,
              )
            : "—"
        }</span></div>
        <div class="row"><span class="label">Будет</span><span>${
          w.nextLesson
            ? escapeHtml(
                `${shortDate(w.nextLesson.date)} ${w.nextLesson.startTime} · ${
                  w.nextLesson.direction ?? ""
                }${w.nextLesson.isTrial ? " (пробное)" : ""}`,
              )
            : "—"
        }</span></div>
      </div>`,
        )
        .join("")
    : `<p class="muted">Подопечные не заведены</p>`

  // Чей это абонемент — важно, когда детей несколько: направления у них часто
  // разные, но по названию не догадаешься. Одного ребёнка не подписываем.
  const wardNames = new Map(card.wards.map((w) => [w.id, w.name]))
  const showWard = card.wards.length > 1

  el.subscriptions.innerHTML = card.subscriptions.length
    ? `<h3>Абонементы</h3>` +
      card.subscriptions
        .map((s) => {
          const wardName = showWard ? wardNames.get(s.wardId) : null
          const title = [s.direction, s.period].filter(Boolean).join(" · ")
          return `
      <div class="row">
        <span>${escapeHtml(title)}${
          wardName ? `<br><span class="muted">${escapeHtml(wardName)}</span>` : ""
        }</span>
        <span>ост. ${s.remainingLessons} из ${s.totalLessons}${
          s.debt > 0 ? `<br><span class="debt-value">долг ${money(s.debt)}</span>` : ""
        }</span>
      </div>`
        })
        .join("")
    : ""

  el.payments.innerHTML = card.payments.length
    ? `<h3>Платежи</h3>` +
      card.payments
        .map(
          (p) => `
      <div class="row">
        <span class="label">${escapeHtml(shortDate(p.date))}${
          p.direction ? " · " + escapeHtml(p.direction) : ""
        }</span>
        <span class="${p.type === "refund" ? "debt-value" : "ok-value"}">${
          p.type === "refund" ? "−" : ""
        }${money(p.amount)}</span>
      </div>`,
        )
        .join("")
    : ""

  el.communications.innerHTML = card.communications.length
    ? `<h3>Переписка и события</h3>` +
      card.communications
        .map(
          (m) => `
      <div class="msg ${m.direction === "outgoing" ? "outgoing" : ""}">
        <div class="meta">${escapeHtml(
          [shortDateTime(m.at), channelLabel(m.channel), m.employeeName].filter(Boolean).join(" · "),
        )}</div>
        <div>${escapeHtml(m.content ?? "")}</div>
      </div>`,
        )
        .join("")
    : ""
}

function channelLabel(channel) {
  return (
    {
      telegram: "Телеграм",
      whatsapp: "WhatsApp",
      vk: "ВКонтакте",
      max: "MAX",
      phone: "Звонок",
      internal: "CRM",
      sms: "SMS",
      email: "Email",
    }[channel] ?? channel
  )
}

// Смена вкладки или чата — перерисовываем; новое сообщение — тихо дообновляем.
chrome.runtime.onMessage.addListener((message, sender) => {
  // Content scripts шлют свои сигналы service worker'у, но получают их все
  // страницы расширения. Панель слушает только его: он один знает, какая
  // вкладка активна, и отсеивает чужие.
  if (sender?.tab) return
  if (message?.type === MSG_STATE_CHANGED) void safeLoadState()
  if (message?.type === MSG_CHAT_ACTIVITY) {
    // Сигнал широковещательный: панель соседнего окна тоже его получает.
    // Без сверки окна она заливала бы переписку своего чата на чужой сигнал.
    if (
      message.windowId != null &&
      panelWindowId != null &&
      message.windowId !== panelWindowId
    ) {
      return
    }
    scheduleActivityRefresh()
  }
})

// Своё окно узнаём ДО первого запроса: иначе service worker возьмёт вкладку
// того окна, что сейчас в фокусе, и панель начнёт работать с чужим чатом.
void (async () => {
  try {
    const win = await chrome.windows.getCurrent()
    panelWindowId = win?.id ?? null
  } catch {
    // Не узнали окно — остаёмся на старом правиле «последнее активное».
  }
  await safeLoadState()
})()
