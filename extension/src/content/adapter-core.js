/**
 * Общий каркас адаптеров мессенджеров (content script, isolated world).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ. Канало-независимого здесь немного по объёму, но в нём
 * сидит около десятка исправлений Фазы 3.1 — гонки, живучесть после обновления
 * расширения, дебаунс наблюдателя, восстановление состояния после сна service
 * worker. Скопировать это во второй адаптер значило бы чинить каждый следующий
 * баг дважды, а через месяц копии разъехались бы молча.
 *
 * ПОЧЕМУ ВСЁ ВНУТРИ IIFE И БЕЗ ОБЪЯВЛЕНИЙ НА ВЕРХНЕМ УРОВНЕ. Все content scripts
 * одного расширения в одном фрейме живут в ОДНОМ изолированном мире и делят его
 * глобальное лексическое окружение. Два файла с одинаковыми именами на верхнем
 * уровне дают SyntaxError «Identifier has already been declared» на инстанциации
 * — ДО первой исполняемой строки, то есть до любого рантайм-гарда. Умирает при
 * этом тот, кто запустился вторым, а это может оказаться как раз нужный адаптер.
 *
 * ЗАМОК ОДИН НА ВСЁ РАСШИРЕНИЕ, а не по каналу. Именной ключ вида
 * «__crmkaTelegramAdapter» защищал только от повторного внедрения того же файла;
 * второй АДАПТЕР поднялся бы рядом, и в одном изолированном мире оказалось бы
 * два слушателя chrome.runtime.onMessage. Chrome отдаёт ответ тому, кто первым
 * синхронно вызвал sendResponse, — поведение плавало бы между перезагрузками, а
 * сообщения одного мессенджера могли уехать в карточку под ключом чата другого.
 *
 * КОНТРАКТ АДАПТЕРА (всё канальное — там):
 *   channel           — «telegram» | «max» | …
 *   ready()           — подгрузились ли чистые модули разбора
 *   readChat(opts)    — ChatContext открытого чата либо null; opts.commit=true
 *                       разрешает двигать внутреннее состояние (зовётся один раз
 *                       за такт наблюдателя, см. reportChat)
 *   collectMessages() — видимые сообщения открытого чата
 *   latestMessageKey()— отпечаток самого свежего сообщения
 *   insertText(text)  — вставить текст в поле ввода, НЕ отправляя
 *   watch(onChange)   — канальный детект смены чата, возвращает отписку
 *   diag()            — произвольные поля в ответ на ping, для диагностики
 */

;(() => {
  // Ядро могло уже подняться: оно первым файлом в ОБЕИХ записях content_scripts,
  // а service worker доинжектирует скрипты в уже открытые вкладки.
  if (globalThis.__crmkaAdapterCore) return

  /** Сколько миллисекунд ждём тишины в DOM, прежде чем разбирать страницу. */
  const OBSERVER_DEBOUNCE_MS = 300

  const MSG_CHAT_CHANGED = "chat-changed"
  const MSG_CHAT_ACTIVITY = "chat-activity"
  const MSG_COLLECT_MESSAGES = "collect-messages"
  const MSG_INSERT_TEXT = "insert-text"
  const MSG_PING = "ping"

  /**
   * Сколько последних сообщений отдаём панели. Дублирует SYNC_MESSAGES_LIMIT из
   * common/types.js: content script в MV3 — классический скрипт, статический
   * import сюда невозможен, а тянуть модуль ради одного числа не стоит.
   * В открытом чате мессенджер держит в DOM сотни сообщений — без хвоста мы бы
   * гоняли на сервер всю подгруженную историю на каждое новое сообщение.
   */
  const COLLECT_LIMIT = 10

  /**
   * Текст узла без служебной обвязки.
   *
   * Время у мессенджеров лежит ВНУТРИ блока текста, поэтому наивный textContent
   * склеивает сообщение с часами: «дальше10:14». Режем по КОПИИ узла —
   * оригинальную разметку страницы мессенджера трогать нельзя.
   *
   * @param {Element|null} node
   * @param {string[]} junkSelectors Что выкинуть перед чтением текста.
   * @returns {string}
   */
  function readCleanText(node, junkSelectors) {
    if (!node) return ""
    const clone = /** @type {HTMLElement} */ (node.cloneNode(true))
    for (const selector of junkSelectors) {
      for (const junk of clone.querySelectorAll(selector)) junk.remove()
    }
    return clone.textContent?.trim() ?? ""
  }

  /**
   * Запустить адаптер. Второй вызов — тихий выход: см. «замок один на всё
   * расширение» в шапке.
   *
   * @param {{
   *   channel: string,
   *   ready: () => boolean,
   *   readChat: (options?: {commit?: boolean}) => any,
   *   collectMessages: () => any[],
   *   latestMessageKey: () => string|null,
   *   insertText: (text: string) => boolean,
   *   watch: (onChange: () => void) => (() => void)|void,
   *   diag?: () => Record<string, unknown>,
   * }} adapter
   */
  function start(adapter) {
    if (globalThis.__crmkaAdapter) return
    globalThis.__crmkaAdapter = adapter.channel

    /** Контекст скрипта умер (расширение обновили) — больше не дёргаемся. */
    let contextLost = false
    /** @type {MutationObserver|null} */
    let domObserver = null
    /** @type {(() => void)|void} */
    let unwatch
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let reportTimer

    /** @type {string|null} */
    let lastChatId = null
    /** @type {string|null} */
    let lastTitle = null
    /** Набор идентификаторов прошлого доклада — канон приезжает позже адреса. @type {string|null} */
    let lastAltKey = null
    /** Отпечаток последнего сообщения: отличает «пришло новое» от перерисовки. @type {string|null} */
    let lastMessageKey = null

    /**
     * Сообщение в service worker.
     *
     * После обновления или перезагрузки расширения контекст этого экземпляра
     * инвалидируется, и chrome.runtime.sendMessage бросает СИНХРОННО
     * («Extension context invalidated») — .catch() такую ошибку не ловит, и
     * падение уносило с собой колбэк наблюдателя DOM. Свежий экземпляр скрипта
     * service worker внедряет сам, поэтому старому остаётся тихо замолчать и
     * отцепиться — вместе с канальным наблюдателем смены чата, иначе его таймер
     * продолжал бы крутиться на мёртвой странице до перезагрузки вкладки.
     *
     * @param {any} message
     */
    function sendToWorker(message) {
      if (contextLost) return
      try {
        if (!chrome.runtime?.id) throw new Error("context lost")
        const sent = chrome.runtime.sendMessage(message)
        if (sent && typeof sent.catch === "function") sent.catch(() => {})
      } catch {
        contextLost = true
        domObserver?.disconnect()
        if (typeof unwatch === "function") unwatch()
      }
    }

    /** Сообщить service worker, какой чат открыт. */
    function reportChat() {
      if (!adapter.ready()) return
      const chat = adapter.readChat({ commit: true })
      const chatId = chat?.chatId ?? null
      const title = chat?.title ?? null
      const altKey = chat?.altIds?.length ? chat.altIds.join(",") : chatId

      // «Ничего не изменилось» считаем и по набору идентификаторов тоже: канон
      // приезжает ПОЗЖЕ адреса (разметка дорисовывается), и на прежнем условии
      // первый доклад без канона остался бы единственным.
      if (chatId === lastChatId && title === lastTitle && altKey === lastAltKey) return

      const chatSwitched = chatId !== lastChatId
      lastChatId = chatId
      lastTitle = title
      lastAltKey = altKey
      // Новый чат — его последнее сообщение «новым» не считаем, иначе смена чата
      // тут же вызвала бы лишнюю заливку поверх штатной (панель и так
      // перечитывает всё при смене чата).
      if (chatSwitched) lastMessageKey = adapter.latestMessageKey()

      sendToWorker({ type: MSG_CHAT_CHANGED, chat })
    }

    /**
     * Сообщить, что в открытом чате появилось новое сообщение — ради этого
     * панель и обновляется на лету, без перезагрузки страницы мессенджера.
     *
     * Чат отдаём вместе с сигналом: service worker в MV3 засыпает и теряет
     * память о том, какой чат открыт, а тут она как раз восстанавливается.
     */
    function reportActivity() {
      if (!adapter.ready()) return
      const chat = adapter.readChat()
      if (!chat) return
      const key = adapter.latestMessageKey()
      if (!key || key === lastMessageKey) return
      lastMessageKey = key
      sendToWorker({ type: MSG_CHAT_ACTIVITY, chat })
    }

    // Разметка при смене чата и при приходе сообщения меняется всегда, своего
    // события у мессенджеров нет. Наблюдатель перерисовывается постоянно,
    // поэтому: (1) дебаунс, (2) обе функции сами сравнивают значения и молчат,
    // если ничего не изменилось — иначе мы бы заваливали service worker
    // сообщениями на каждый кадр анимации.
    domObserver = new MutationObserver(() => {
      if (contextLost) return
      clearTimeout(reportTimer)
      reportTimer = setTimeout(() => {
        reportChat()
        reportActivity()
      }, OBSERVER_DEBOUNCE_MS)
    })
    domObserver.observe(document.body, { childList: true, subtree: true })

    // Детект смены чата канальный: у Telegram это hashchange, у MAX хэша нет
    // вовсе и нужен опрос адреса.
    unwatch = adapter.watch(() => reportChat())

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === MSG_COLLECT_MESSAGES) {
        sendResponse({ messages: adapter.collectMessages() })
        return false
      }
      if (message?.type === MSG_INSERT_TEXT) {
        sendResponse({ inserted: adapter.insertText(String(message.text ?? "")) })
        return false
      }
      if (message?.type === MSG_PING) {
        // Панель по этому ответу отличает «скрипт не подключён к странице» от
        // «скрипт работает, но чат не выбран», и подсказывает человеку нужное.
        const chat = adapter.readChat()
        sendResponse({
          alive: true,
          channel: adapter.channel,
          // ready=false значит модули разбора ещё не подгрузились — это уже
          // другая причина «нет чата», чем «чат не выбран».
          ready: adapter.ready(),
          chatId: chat?.chatId ?? null,
          // Откуда взялся канон либо почему его нет. Поломка селекторов иначе
          // молчалива: система тихо вернётся к прежнему поведению, а узнаем мы
          // об этом через месяц по новым дублям в карточках.
          peerSource: chat?.peerSource ?? null,
          // Полный контекст чата: service worker в MV3 засыпает и забывает,
          // какой чат открыт, а content script знает это всегда. Без этого
          // панель после сна фонового скрипта писала «откройте чат» до
          // перезагрузки страницы.
          chat,
          ...(adapter.diag ? adapter.diag() : {}),
        })
        return false
      }
      return false
    })

    // Первый доклад — сразу: панель может быть уже открыта.
    reportChat()
  }

  globalThis.__crmkaAdapterCore = { start, readCleanText, COLLECT_LIMIT }
})()
