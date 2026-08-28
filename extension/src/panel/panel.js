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
}

/**
 * Запрос к service worker. Он отвечает конвертом {ok, result|error}, чтобы
 * ошибка API не превращалась в необработанный reject в панели.
 * @param {any} message
 * @returns {Promise<any>}
 */
async function send(message) {
  const response = await chrome.runtime.sendMessage(message)
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

/** @param {number} value */
function money(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + " ₽"
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

async function loadState() {
  const data = await send({ type: MSG_GET_STATE })
  state.chat = data.chat
  state.tab = data.tab ?? null
  state.baseUrl = data.settings.baseUrl
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
  await renderForChat()
}

el.settingsToggle.addEventListener("click", () => {
  state.showSetup = !state.showSetup
  void loadState()
})

// Уход с настроек без сохранения: набранное в полях просто забываем — в
// хранилище оно и не попадало.
el.setupBack.addEventListener("click", () => {
  el.token.value = ""
  el.setupError.hidden = true
  state.showSetup = false
  void loadState()
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
    await loadState()
  } catch (error) {
    el.setupError.textContent = error instanceof Error ? error.message : "Не удалось сохранить"
    el.setupError.hidden = false
  } finally {
    el.saveSettings.disabled = false
  }
})

// ─── Основной экран ───

async function renderForChat() {
  el.card.hidden = true
  el.unmatched.hidden = true
  el.noChat.hidden = true
  el.reloadTab.hidden = true
  el.quick.hidden = true
  closeAction()
  state.clientId = null
  // Справку перечитываем заново: сменился чат — сменился и клиент, а по ⟳
  // человек как раз и ждёт свежие данные.
  quickInfoFor = null

  if (!state.chat) {
    showNoChatReason()
    return
  }

  showStatus("Ищем клиента…")
  /** @type {ResolveResult} */
  let resolved
  try {
    resolved = await api("resolve", {
      channel: state.chat.channel,
      chatId: state.chat.chatId,
      phone: state.chat.phone,
    })
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Ошибка запроса")
    return
  }

  if (resolved.clientId) {
    await showClient(resolved.clientId)
    return
  }

  showStatus("")
  el.unmatched.hidden = false
  el.candidates.innerHTML = ""
  el.searchResults.innerHTML = ""
  el.searchInput.value = ""

  const who = state.chat.title ? `«${state.chat.title}»` : `@${state.chat.chatId}`
  if (resolved.candidates.length > 0) {
    el.unmatchedTitle.textContent = `Кого из клиентов означает чат ${who}?`
    renderCandidates(el.candidates, resolved.candidates)
  } else {
    el.unmatchedTitle.textContent = `Чат ${who} пока не связан с клиентом. Найдите его — связь запомнится.`
  }
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
      void loadState()
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
  if (!state.chat) return
  showStatus("Связываем…")
  try {
    await api("bind", {
      channel: state.chat.channel,
      chatId: state.chat.chatId,
      clientId,
      displayName: state.chat.title,
      saveHandle: true,
    })
    el.unmatched.hidden = true
    await showClient(clientId)
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Не удалось связать")
  }
}

el.unbind.addEventListener("click", async () => {
  if (!state.chat) return
  showStatus("Отвязываем…")
  try {
    await api("unbind", { channel: state.chat.channel, chatId: state.chat.chatId })
    await renderForChat()
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Не удалось отвязать")
  }
})

/** Поиск клиента для ручной привязки. */
let searchTimer
el.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer)
  const query = el.searchInput.value.trim()
  if (query.length < 2) {
    el.searchResults.innerHTML = ""
    return
  }
  searchTimer = setTimeout(async () => {
    try {
      const data = await api("search", { q: query })
      renderCandidates(el.searchResults, data.clients ?? [])
    } catch (error) {
      el.searchResults.innerHTML = `<p class="error">${escapeHtml(
        error instanceof Error ? error.message : "Ошибка поиска",
      )}</p>`
    }
  }, 300)
})

/**
 * @param {string} clientId
 * @param {{silent?: boolean}} [options] silent — фоновое обновление: не мигаем
 *   статусом «Загружаем карточку…» и молча переживаем ошибку сети.
 */
async function showClient(clientId, options = {}) {
  const silent = options.silent === true
  if (!silent) showStatus("Загружаем карточку…")
  let card
  try {
    card = await api("client-card", { clientId })
  } catch (error) {
    if (!silent) showStatus(error instanceof Error ? error.message : "Не удалось загрузить карточку")
    return
  }

  // Пока ходили за карточкой, человек мог переключить чат — чужую не рисуем.
  if (silent && state.clientId !== clientId) return

  state.clientId = clientId
  if (!silent) showStatus("")
  el.unmatched.hidden = true
  el.card.hidden = false
  renderCard(card)

  // Переписку заливаем в фоне: она не должна задерживать показ карточки, а
  // сервер всё равно пропустит уже известные сообщения.
  void syncMessagesAndRefresh(clientId)
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
  let result
  try {
    result = await send({ type: MSG_SYNC_MESSAGES, clientId })
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
    button.addEventListener("click", () => void insertIntoChat(item.text, button))
  }
}

/**
 * Вставить текст в поле ввода мессенджера. Именно вставить: отправляет человек.
 * @param {string} text
 * @param {HTMLButtonElement} button
 */
async function insertIntoChat(text, button) {
  button.disabled = true
  try {
    const result = await send({ type: MSG_INSERT_TEXT, text })
    if (result?.inserted) {
      flashStatus("Текст вставлен в поле ввода — проверьте и отправьте")
      return
    }
    // Поле ввода не нашли (чат закрыт, непривычная вёрстка) — отдаём текст
    // через буфер обмена, чтобы человек не перенабирал его руками.
    try {
      await navigator.clipboard.writeText(text)
      flashStatus("Поле ввода не найдено — текст скопирован, вставьте вручную")
    } catch {
      flashStatus("Не удалось вставить текст")
    }
  } catch {
    flashStatus("Не удалось вставить текст")
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
  el.aiDraft.disabled = true
  const label = el.aiDraft.textContent
  el.aiDraft.textContent = "✨ Готовим…"
  try {
    const result = await send({ type: MSG_AI_DRAFT, clientId: state.clientId })
    if (!result?.text) {
      flashStatus("ИИ не вернул черновик — попробуйте ещё раз")
      return
    }
    await insertIntoChat(result.text, el.aiDraft)
    flashStatus("Черновик вставлен — прочитайте и поправьте перед отправкой")
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

/** Сегодня в формате поля type="date" — местная дата, а не UTC. */
function todayInputValue() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

/** @param {"task"|"note"} kind */
function openAction(kind) {
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
  el.actionDue.value = todayInputValue()
  el.actionText.value = ""
  el.actionText.focus()
}

function closeAction() {
  actionKind = null
  el.actionForm.hidden = true
  el.actionText.value = ""
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
    await loadState()
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
        : "Баланс: 0 ₽"

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
  if (message?.type === MSG_STATE_CHANGED) void loadState()
  if (message?.type === MSG_CHAT_ACTIVITY) scheduleActivityRefresh()
})

void loadState()
