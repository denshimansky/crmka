/**
 * Side panel — единственный видимый кусок расширения.
 *
 * Сама панель в API не ходит: все запросы идёт через service worker (там токен
 * и host_permissions). Здесь только состояние экрана и отрисовка.
 */

import {
  MSG_API,
  MSG_GET_STATE,
  MSG_RELOAD_TAB,
  MSG_SAVE_SETTINGS,
  MSG_STATE_CHANGED,
  MSG_SYNC_MESSAGES,
} from "../common/types.js"

/** @typedef {import("../common/types.js").ChatContext} ChatContext */
/** @typedef {import("../common/types.js").ResolveResult} ResolveResult */

const el = {
  settingsToggle: /** @type {HTMLButtonElement} */ (document.getElementById("settings-toggle")),
  setup: /** @type {HTMLElement} */ (document.getElementById("setup")),
  main: /** @type {HTMLElement} */ (document.getElementById("main")),
  baseUrl: /** @type {HTMLInputElement} */ (document.getElementById("base-url")),
  token: /** @type {HTMLInputElement} */ (document.getElementById("token")),
  logMessages: /** @type {HTMLInputElement} */ (document.getElementById("log-messages")),
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
  state.clientId = null

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

/** @param {string} clientId */
async function showClient(clientId) {
  showStatus("Загружаем карточку…")
  let card
  try {
    card = await api("client-card", { clientId })
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Не удалось загрузить карточку")
    return
  }

  state.clientId = clientId
  showStatus("")
  el.unmatched.hidden = true
  el.card.hidden = false
  renderCard(card)

  // Переписку заливаем в фоне: она не должна задерживать показ карточки, а
  // сервер всё равно пропустит уже известные сообщения.
  void send({ type: MSG_SYNC_MESSAGES, clientId }).catch(() => {})
}

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

// Смена вкладки или чата — перерисовываем.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MSG_STATE_CHANGED) void loadState()
})

void loadState()
