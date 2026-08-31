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

// Ни одного объявления на ВЕРХНЕМ уровне: все content scripts расширения делят
// глобальное лексическое окружение изолированного мира, и одинаковые имена в
// двух адаптерах дали бы SyntaxError на инстанциации — до первой исполняемой
// строки, то есть до любого рантайм-гарда. Умер бы при этом тот, кто запустился
// вторым, а это мог оказаться как раз нужный адаптер.
;(() => {
  const core = /** @type {any} */ (globalThis).__crmkaAdapterCore
  // Ядро объявлено первым файлом этой же записи content_scripts. Нет его —
  // значит манифест собран неправильно; молча выходим, страницу не ломаем.
  if (!core) return

  const COLLECT_LIMIT = core.COLLECT_LIMIT
  const readCleanText = core.readCleanText

/** @typedef {import("../common/types.js").ChatContext} ChatContext */
/** @typedef {import("../common/types.js").ChatMessage} ChatMessage */

// Content script в MV3 — классический скрипт, статический import в нём
// невозможен. Разбор хэша вынесен в отдельный модуль (он покрыт тестами),
// поэтому подтягиваем его динамически; файл объявлен в web_accessible_resources.
// null до загрузки модуля — по этому же признаку понимаем, готов ли адаптер.
/** @type {typeof import("../common/telegram-hash.js").parseTelegramChatId | null} */
let parseTelegramChatId = null
/** @type {typeof import("../common/telegram-hash.js").detectTelegramClient | null} */
let detectTelegramClient = null
/** @type {typeof import("../common/telegram-time.js").parseBubbleTitleDate | null} */
let parseBubbleTitleDate = null
/**
 * Модуль каноникализации собеседника. null до загрузки — тогда работаем ровно
 * как раньше: ключом чата остаётся значение из адресной строки.
 * @type {typeof import("../common/telegram-peer.js") | null}
 */
let peerModule = null

/** Какой из двух клиентов открыт (до загрузки модуля считаем WebK — он чаще). @returns {"k"|"a"} */
function detectClient() {
  return detectTelegramClient ? detectTelegramClient(location.pathname) : "k"
}

/**
 * Идентификатор открытого чата из адресной строки. Разбор — в чистом модуле
 * common/telegram-hash.js, он покрыт тестами (формат хэша — хрупкий стык).
 * @returns {string|null}
 */
function readChatIdFromHash() {
  return parseTelegramChatId ? parseTelegramChatId(location.hash) : null
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
 * Служебные сообщения («вступил в чат») пропускаем. Отдаём ТОЛЬКО хвост —
 * последние COLLECT_LIMIT сообщений: в DOM открытого чата лежит вся
 * подгруженная история, и заливать её целиком в CRM нельзя (лента коммуникаций
 * утонет в старой переписке). Идём с конца — так же дёшево при сотнях пузырей.
 * @returns {ChatMessage[]}
 */
function collectVisibleMessages() {
  const isWebA = detectClient() === "a"
  const root = messagesRoot()
  // Контейнер нашёлся — верим ему, даже если он пуст. Пустой активный чат —
  // штатное состояние (первый диалог с родителем, чат из одних фото), и
  // подмена его документом означала бы ровно то, от чего сужение и защищает:
  // Telegram держит в DOM контейнеры других открытых чатов, а ключ сообщения
  // склеивается с chatId ТЕКУЩЕГО — чужая переписка осела бы в чужой карточке
  // навсегда. Документ берём, только если ни один селектор не подошёл вовсе:
  // это уже поломка вёрстки, и прежнее поведение здесь лучше, чем немота.
  return isWebA ? collectWebA(root ?? document.body) : collectWebK(root ?? document.body)
}

/**
 * Контейнер активного диалога.
 *
 * Собирать пузыри по всему документу нельзя: Telegram держит в DOM разметку и
 * других недавно открытых чатов, а ключ сообщения склеивается с chatId ТЕКУЩЕГО
 * диалога — чужая переписка уезжала бы в карточку этого клиента, и убрать её
 * потом нечем: уникальный ключ не даёт переписать строку.
 *
 * Селекторы вёрстки хрупкие, поэтому возвращаем null, когда не подошёл ни
 * один: решение «что делать дальше» принимает вызывающий.
 * @returns {HTMLElement|null}
 */
function messagesRoot() {
  const selectors =
    detectClient() === "a"
      ? ["#MiddleColumn .messages-container", "#MiddleColumn"]
      : [
          // Предпросмотр диалога (shift+click по списку) открывается ОТДЕЛЬНЫМ
          // блоком с теми же классами chat+active, но вне #column-center. Без
          // :not(.chat-preview) прежний фоллбэк «.chat.active» ловил его — и
          // переписка чужого диалога уехала бы в открытую карточку.
          "#column-center .chats-container > .chat.active:not(.chat-preview)",
          ".chats-container .chat.active:not(.chat-preview)",
          ".chat.active:not(.chat-preview)",
          "#column-center",
        ]
  for (const selector of selectors) {
    const node = document.querySelector(selector)
    if (node) return /** @type {HTMLElement} */ (node)
  }
  return null
}

/**
 * Числовой peer id открытого чата из ВИДИМОЙ разметки WebK.
 *
 * Только /k: в WebA число и так лежит в адресной строке. Читаем ровно те
 * атрибуты, которые клиент проставляет сам (см. common/telegram-peer.js) —
 * никакого localStorage, IndexedDB и внедрения скриптов в страницу.
 *
 * Решение «принять или отказаться» принимает чистый pickPeerId; здесь только
 * сбор кандидатов. Пустой список — штатный исход.
 *
 * @returns {Array<{source: string, value: string}>}
 */
function readNumericPeerId() {
  if (detectClient() !== "k") return []
  const chat =
    document.querySelector("#column-center .chats-container > .chat.active:not(.chat-preview)") ??
    document.querySelector("#column-center .chat.active:not(.chat-preview)")
  if (!chat) return []

  /** @type {Array<{source: string, value: string}>} */
  const out = []
  /** @param {string} source @param {Element|null|undefined} node */
  const push = (source, node) => {
    if (!(node instanceof HTMLElement)) return
    const value = node.dataset.peerId
    if (value) out.push({ source, value })
  }

  // Поле ввода несёт чистый chat.peerId. Зеркало для расчёта высоты
  // (.input-field-input-fake) тоже contenteditable — его берём мимо.
  push(
    "composer",
    chat.querySelector(".input-message-input[data-peer-id]:not(.input-field-input-fake)"),
  )
  // На САМОМ пузыре лежит пир ДИАЛОГА (message.peerId). Внутрь пузыря лезть
  // нельзя: там data-peer-id ОТПРАВИТЕЛЯ и автора пересылки — в группе это
  // разные люди, и канон уехал бы на постороннего.
  const bubbles = chat.querySelectorAll(".bubble[data-mid][data-peer-id]")
  push("bubble", bubbles[bubbles.length - 1])
  push("avatar", chat.querySelector(".chat-info .person-avatar[data-peer-id]"))
  push("title", chat.querySelector(".chat-info .peer-title[data-peer-id]"))
  // Прод-сборка может отставать от master, где <avatar-element> уже убрали.
  push("avatar-legacy", chat.querySelector("avatar-element[data-peer-id]"))
  // Перекрёстная проверка из списка диалогов — он живёт вне контейнера чата.
  push("chatlist", document.querySelector("#column-left .chatlist-chat.active[data-peer-id]"))
  return out
}

/**
 * Канон открытого чата и полный набор его идентификаторов.
 *
 * @param {string} chatId Значение из адресной строки.
 * @param {{commit?: boolean}} [options] commit — можно двигать состояние
 *   подтверждения. Только reportChat: он вызывается раз на такт наблюдателя,
 *   а значит два его вызова подряд — это два РАЗНЫХ кадра разметки. readChat
 *   же дёргается по ping и по сигналу активности, и разрешив ему двигать
 *   состояние, мы бы «подтвердили» stale-число по одному и тому же кадру.
 * @returns {{altIds: string[], peerId: string|null, source: string|null, reason: string}}
 */
function pickPeer(chatId, options = {}) {
  if (!peerModule) {
    return { altIds: [chatId], peerId: null, source: null, reason: "модуль канона не загружен" }
  }
  const picked = peerModule.pickPeerId({
    hashId: chatId,
    sources: readNumericPeerId(),
    previousPeerId: lastPeerId,
    // Гард «кадр перехода» держим до тех пор, пока канон не принят для ЭТОГО
    // чата: разметка прошлого диалога живёт ещё несколько кадров после смены.
    chatSwitched: chatId !== lastPeerChatId,
  })

  let peerId = picked.peerId
  let reason = picked.reason
  if (peerId && picked.needsConfirmation) {
    // Число взято ТОЛЬКО из разметки. Одиночному наблюдению здесь верить
    // нельзя: tweb переиспользует контейнер чата, и сразу после переключения
    // диалога в нём ещё живёт пир ПРОШЛОГО собеседника. Сравнения с последним
    // принятым каноном мало — если для промежуточного чата канон не приняли,
    // сравнивать будет не с чем. Поэтому ждём, пока одно и то же число придёт
    // дважды подряд для одного и того же чата.
    const confirmed = pendingPeerChatId === chatId && pendingPeerId === peerId
    if (!confirmed) {
      if (options.commit) {
        pendingPeerChatId = chatId
        pendingPeerId = peerId
      }
      peerId = null
      reason = "ждём подтверждения вторым наблюдением"
    }
  } else if (options.commit && !peerId) {
    pendingPeerChatId = null
    pendingPeerId = null
  }

  return {
    altIds: peerModule.buildAltIds({ hashId: chatId, peerId }),
    peerId,
    source: peerId ? picked.source : null,
    reason,
  }
}

/**
 * Id сообщения WebK. Без модуля канона — прежнее поведение.
 * @param {HTMLElement} el @returns {string|null}
 */
function messageIdWebK(el) {
  const raw = el.dataset.mid ?? null
  if (!peerModule) return raw
  return peerModule.parseWebKMessageId(raw)
}

/**
 * Id сообщения WebA. Без модуля канона — прежнее поведение.
 * @param {HTMLElement} el @returns {string|null}
 */
function messageIdWebA(el) {
  if (peerModule) {
    return peerModule.parseWebAMessageId({ dataMessageId: el.dataset.messageId, htmlId: el.id })
  }
  const id = el.id.slice("message-".length).split("-")[0]
  return id && /^\d+$/.test(id) ? id : null
}

/**
 * Время отправки пузыря WebK.
 *
 * Машинного времени в разметке нет вовсе — на пузыре только data-mid. Полная
 * дата живёт в подсказке `title` у `.time-inner` (её показывает Telegram при
 * наведении), разбор — в common/telegram-time.js. Не разобрали — null, и
 * время проставит сервер: лучше время заливки, чем выдуманная дата.
 *
 * @param {HTMLElement} el
 * @returns {string|null}
 */
function readWebKSentAt(el) {
  // На старых сборках время лежало на самом пузыре — проверяем и это.
  const timestamp = Number(el.dataset.timestamp)
  if (Number.isFinite(timestamp) && timestamp > 0) return new Date(timestamp * 1000).toISOString()
  if (!parseBubbleTitleDate) return null
  const holder = el.querySelector(".time-inner[title], .time [title], .time[title]")
  return parseBubbleTitleDate(holder?.getAttribute("title"))
}

/** @param {HTMLElement} root @returns {ChatMessage[]} */
function collectWebK(root) {
  /** @type {ChatMessage[]} */
  const out = []
  const nodes = root.querySelectorAll(".bubble[data-mid]")
  for (let i = nodes.length - 1; i >= 0 && out.length < COLLECT_LIMIT; i--) {
    const node = nodes[i]
    if (node.classList.contains("service")) continue
    const el = /** @type {HTMLElement} */ (node)
    // Локальный (ещё не отправленный) id пропускаем: через секунду это же
    // сообщение приедет с настоящим id и легло бы в карточку второй строкой.
    const mid = messageIdWebK(el)
    if (!mid) continue
    // .time — часы в конце пузыря, .reply — цитата чужого сообщения,
    // .reactions — эмодзи-реакции: в историю клиента это не переписка.
    const text = readCleanText(el.querySelector(".message"), [
      ".time",
      ".reply",
      ".reactions",
      ".bubble-beside-button",
    ])
    if (!text) continue
    out.push({
      externalId: mid,
      direction: el.classList.contains("is-out") ? "outgoing" : "incoming",
      text,
      sentAt: readWebKSentAt(el),
    })
  }
  // Шли с конца — возвращаем в хронологическом порядке.
  return out.reverse()
}

/** @param {HTMLElement} root @returns {ChatMessage[]} */
function collectWebA(root) {
  /** @type {ChatMessage[]} */
  const out = []
  const nodes = root.querySelectorAll('[id^="message-"]')
  for (let i = nodes.length - 1; i >= 0 && out.length < COLLECT_LIMIT; i--) {
    const el = /** @type {HTMLElement} */ (nodes[i])
    // «message-<id>» и «message-<id>-<index>» у альбомов дают один и тот же id;
    // «message-<id>-<000001>» — ЛОКАЛЬНОЕ, ещё не отправленное сообщение, его
    // заливать нельзя (разбор — в common/telegram-peer.js).
    const id = messageIdWebA(el)
    if (!id) continue
    if (out.some((m) => m.externalId === id)) continue
    // .MessageMeta — время и галочки доставки, они внутри блока текста и без
    // чистки приклеиваются к сообщению; .Reactions — эмодзи-реакции.
    const text = readCleanText(el.querySelector(".text-content"), [
      ".MessageMeta",
      ".Reactions",
      ".EmbeddedMessage",
    ])
    if (!text) continue
    out.push({
      externalId: id,
      direction: el.classList.contains("own") ? "outgoing" : "incoming",
      text,
      // Времени здесь взять НЕОТКУДА, и это проверено по исходникам клиента:
      // telegram-tt проставляет подсказку title у .message-time только по
      // наведению курсора (useFlag + onMouseEnter), а машинных атрибутов на
      // пузыре нет вовсе. Порядок сообщений при этом не теряется: сервер
      // раскладывает пачку без времени по позиции в ней (см. batch/route.ts).
      sentAt: null,
    })
  }
  return out.reverse()
}

/**
 * Отпечаток «самого свежего сообщения в чате» — по нему понимаем, что пришло
 * новое, не разбирая текст. Берём максимальный id: он растёт, а количество
 * пузырей в DOM скачет само по себе (Telegram виртуализирует список и
 * выгружает то, что уехало за экран), из-за чего счётчик врал бы на каждой
 * прокрутке.
 * @returns {string|null}
 */
function readLatestMessageKey() {
  const isWebA = detectClient() === "a"
  const selector = isWebA ? '[id^="message-"]' : ".bubble[data-mid]"
  // Та же область, что и у сбора сообщений: максимальный id по всему документу
  // прыгал бы при переключении чатов и выдавал «пришло новое» на ровном месте.
  const nodes = (messagesRoot() ?? document.body).querySelectorAll(selector)
  let max = 0
  for (const node of nodes) {
    const el = /** @type {HTMLElement} */ (node)
    // Через те же парсеры: дробный временный id иначе давал бы ложный сигнал
    // «пришло новое» на каждое своё же отправленное сообщение.
    const raw = isWebA ? messageIdWebA(el) : messageIdWebK(el)
    const value = Number(raw)
    if (Number.isFinite(value) && value > max) max = value
  }
  return max > 0 ? String(max) : null
}

/**
 * Поле ввода сообщения. У обоих клиентов это contenteditable, но в разметке
 * таких полей несколько (поиск, подпись к медиа, скрытые чаты) — берём видимое.
 * @returns {HTMLElement|null}
 */
function findComposer() {
  const selectors =
    detectClient() === "a"
      ? ["#editable-message-text", ".form-control[contenteditable='true']"]
      : [
          // .input-field-input-fake — невидимое зеркало для расчёта высоты, оно
          // тоже contenteditable и стоит РАНЬШЕ настоящего поля в разметке.
          ".chat-input .input-message-input[contenteditable='true']:not(.input-field-input-fake)",
          ".input-message-input[contenteditable='true']:not(.input-field-input-fake)",
        ]
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const el = /** @type {HTMLElement} */ (node)
      // offsetParent = null у скрытых элементов; getClientRects страхует случай
      // position: fixed, где offsetParent тоже null, но поле видно.
      if (el.isContentEditable && (el.offsetParent || el.getClientRects().length > 0)) return el
    }
  }
  return null
}

/** Каретка в конец поля — вставляем в конец черновика, не затирая набранное. */
function placeCaretAtEnd(el) {
  const selection = window.getSelection()
  if (!selection) return
  // Если человек уже стоит курсором внутри поля, его позицию не трогаем.
  if (selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).commonAncestorContainer)) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * Вставить текст в поле ввода — НЕ отправляя.
 *
 * Через execCommand, а не правкой textContent: мессенджеры — SPA (Solid у WebK,
 * React у WebA), они следят за полем через события ввода. Прямая правка DOM их
 * не будит — поле выглядит заполненным, но клиент считает его пустым и не
 * активирует кнопку отправки. execCommand идёт через штатный конвейер
 * редактирования и порождает настоящие beforeinput/input.
 *
 * Переводы строк вставляем отдельной командой: «\n» внутри insertText
 * обрабатывается браузерами по-разному, а справка у нас многострочная.
 *
 * @param {string} text
 * @returns {boolean} удалось ли найти поле и вставить
 */
function insertIntoComposer(text) {
  const el = findComposer()
  if (!el || !text) return false
  el.focus()
  placeCaretAtEnd(el)

  const before = el.textContent ?? ""
  const lines = String(text).split("\n")
  lines.forEach((line, index) => {
    if (index > 0) document.execCommand("insertLineBreak")
    if (line) document.execCommand("insertText", false, line)
  })

  // Судим по факту, а не по коду возврата execCommand: он отдаёт false и при
  // ЧАСТИЧНОМ успехе, и тогда запасной путь дописывал ВЕСЬ текст поверх уже
  // вставленного — справка задваивалась прямо в поле ввода.
  if ((el.textContent ?? "") !== before) return true

  // Запасной путь на случай, если execCommand когда-нибудь уберут: правим поле
  // сами и сами сообщаем фреймворку об изменении.
  el.textContent = `${before}${text}`
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }))
  // Честный ответ панели: не вышло — она положит текст в буфер обмена.
  return (el.textContent ?? "") !== before
}

/** Принятый канон и чат, для которого он принят: пара нужна гарду «кадр перехода». @type {string|null} */
let lastPeerId = null
/** @type {string|null} */
let lastPeerChatId = null
/** Число, увиденное на прошлом такте, и чат, в котором его видели. @type {string|null} */
let pendingPeerId = null
/** @type {string|null} */
let pendingPeerChatId = null

/**
 * Открытый чат как контекст для панели.
 *
 * @param {{commit?: boolean}} [options] commit — можно двигать состояние
 *   подтверждения канона. Ставит его только доклад ядра: он вызывается раз на
 *   такт наблюдателя, а значит два вызова подряд это два РАЗНЫХ кадра разметки.
 * @returns {ChatContext|null}
 */
function readChat(options = {}) {
  const chatId = readChatIdFromHash()
  if (!chatId) return null
  const picked = pickPeer(chatId, options)
  return {
    channel: "telegram",
    chatId,
    altIds: picked.altIds,
    peerSource: picked.source ?? picked.reason,
    title: readChatTitle(),
    phone: null,
  }
}

// Старт: сначала подгружаем чистые модули (разбор хэша, времени и канона),
// потом отдаём ядру описание канала. До загрузки хэш-модуля адаптер не готов —
// ядро само это учитывает через ready().
Promise.all([
  import(chrome.runtime.getURL("src/common/telegram-hash.js")),
  import(chrome.runtime.getURL("src/common/telegram-time.js")).catch(() => null),
  // Канон необязателен: не загрузился — работаем как раньше, ключом чата
  // остаётся значение из адресной строки.
  import(chrome.runtime.getURL("src/common/telegram-peer.js")).catch(() => null),
])
  .then(([hash, time, peer]) => {
    parseTelegramChatId = hash.parseTelegramChatId
    detectTelegramClient = hash.detectTelegramClient
    parseBubbleTitleDate = time?.parseBubbleTitleDate ?? null
    peerModule = peer ?? null

    core.start({
      channel: "telegram",
      ready: () => Boolean(parseTelegramChatId),
      readChat,
      collectMessages: collectVisibleMessages,
      latestMessageKey: readLatestMessageKey,
      insertText: insertIntoComposer,
      // Смена чата — это смена хэша: клиент SPA, полноценной навигации нет.
      watch: (onChange) => {
        const handler = () => onChange()
        window.addEventListener("hashchange", handler)
        return () => window.removeEventListener("hashchange", handler)
      },
      // Диагностика в ответе ping: по ней панель показывает, что видит адаптер.
      diag: () => ({ client: detectClient(), hash: location.hash || null }),
    })
  })
  .catch(() => {
    // Модуль не загрузился (крайне маловероятно — файл свой же). Панель
    // покажет «откройте чат»: лучше, чем сломанная страница мессенджера.
  })
})()
