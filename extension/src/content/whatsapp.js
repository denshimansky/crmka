/**
 * Адаптер WhatsApp Web (web.whatsapp.com) — content script, isolated world.
 *
 * ЧТО ВАЖНО ЗНАТЬ ПРО WHATSAPP (docs/messenger-extension.md §8, Фаза 5).
 * Опоры взяты из разбора прод-бандла (репозиторий с ежедневным экспортом
 * скриптов с static.whatsapp.net), а не из статей — в интернете по WhatsApp
 * почти всё устарело.
 *
 *   • АДРЕС НЕ МЕНЯЕТСЯ при переключении чата: роутинга по чатам в коде нет
 *     вовсе. То есть приёмы Telegram (хэш) и MAX (путь) здесь не работают, и
 *     «какой чат открыт» читается ТОЛЬКО из разметки;
 *   • у строки сообщения есть `data-id` — это сериализованный `MsgKey`
 *     «fromMe_чат_id[_self][_участник]». В нём и настоящий идентификатор
 *     сообщения, и JID чата. Отсюда два подарка, которых не было в MAX: ключ
 *     дедупа НАСТОЯЩИЙ (правка сообщения не даст вторую строку, два одинаковых
 *     сообщения в минуту не схлопнутся) и chatId у каждого сообщения СВОЙ;
 *   • ПОСЛЕДНЕЕ ВАЖНЕЕ, ЧЕМ КАЖЕТСЯ. В MAX пришлось вводить окно SETTLE_MS:
 *     адрес там менялся раньше, чем перерисовывалась лента, и сообщения
 *     прошлого чата уехали бы в карточку нового. Здесь такой гонки нет по
 *     построению — каждое сообщение приносит свой чат, и достаточно брать
 *     только те, что принадлежат текущему;
 *   • НАПРАВЛЕНИЕ — авторские классы `message-in` / `message-out` на внутреннем
 *     div пузыря. Служебные строки (шифрование, звонки, события) — это те же
 *     строки с `data-id`, но БЕЗ обоих классов: оба гасятся флагом
 *     isNotification. Отсюда правило отбраковки, и оно СТРУКТУРНОЕ, а не
 *     словарное — в MAX словарь звонков остался временной мерой, которая
 *     протекает на каждой новой формулировке;
 *   • ВРЕМЯ — только в `data-pre-plain-text` («[16:04, 12.08.2026] Имя: »),
 *     машинного unix-времени в разметке нет. Разбор — common/wa-time.js;
 *   • ТЕЛЕФОН иногда есть, и это единственный такой канал: если JID чата
 *     телефонный («…@c.us»), номер в нём и лежит. Но WhatsApp переводит личные
 *     чаты на скрытый идентификатор («…@lid»), и тогда номера нет — клиента
 *     находит человек, связь запоминается привязкой, как в MAX;
 *   • ГРУППЫ, РАССЫЛКИ, СТАТУСЫ И КАНАЛЫ панель НЕ ОБСЛУЖИВАЕТ. Решение то же,
 *     что для MAX, и по той же причине: за таким чатом стоит не один человек, а
 *     цена ошибки необратима — уникальный ключ не даст убрать чужую переписку
 *     из карточки.
 *
 * БЕЗОПАСНОСТЬ — здесь строже, чем в других каналах.
 *   • MAIN-world НЕ ИСПОЛЬЗУЕМ и к `window.Store` / `WPP` не прикасаемся: так
 *     работают библиотеки автоматизации WhatsApp, и именно за это блокируют
 *     аккаунты. Наш путь другой — пассивное чтение того, что и так на экране;
 *   • localStorage и IndexedDB НЕ ТРОГАЕМ: там ключи сессии;
 *   • НИКОГДА не синтезируем `keydown` Enter и не нажимаем кнопку отправки
 *     (у неё `data-tab="11"`): Enter в поле ввода отправляет сообщение, и
 *     проверки isTrusted у обработчика нет. Отправляет человек — это
 *     принцип-щит §3 спеки, а не деталь реализации.
 */

// Ни одного объявления на ВЕРХНЕМ уровне: все content scripts расширения делят
// глобальное лексическое окружение изолированного мира, и одинаковые имена в
// двух адаптерах дали бы SyntaxError на инстанциации — до первой исполняемой
// строки, то есть до любого рантайм-гарда.
;(() => {
  const core = /** @type {any} */ (globalThis).__crmkaAdapterCore
  if (!core) return

  const COLLECT_LIMIT = core.COLLECT_LIMIT
  const readCleanText = core.readCleanText

  /** @typedef {import("../common/types.js").ChatContext} ChatContext */
  /** @typedef {import("../common/types.js").ChatMessage} ChatMessage */

  /**
   * ВСТРОЕННЫЕ СЕЛЕКТОРЫ — и одновременно набор ключей, которые можно
   * переопределить удалённым конфигом (§3 спеки): разметка чужого сайта меняется
   * без предупреждения, и чинить канал публикацией в стор с многодневным ревью
   * недопустимо.
   *
   * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. Ни одного селектора на обфусцированные классы
   * (`_amjv`, `x1klvx2g` — они меняются от сборки к сборке) и ни одного на
   * `data-testid`: в чат-интерфейсе WhatsApp вырезал их на уровне сборки, и все
   * ходовые советы из интернета (`[data-testid="conversation-compose-box-input"]`,
   * `[data-testid="msg-container"]`) в проде мертвы. Уцелел ровно один —
   * `selectable-text` на самом тексте сообщения, потому что собирается в
   * рантайме; на него мы опираемся с фоллбэком.
   */
  const DEFAULTS = {
    /** Контейнер открытого чата. id литеральный, живёт годами. */
    root: "#main",
    /** Строка сообщения. Она же несёт ключ MsgKey. */
    row: "[data-id]",
    /** Направление. Классы авторские, стоят на ВНУТРЕННЕМ div пузыря. */
    incoming: ".message-in",
    outgoing: ".message-out",
    /**
     * Текст сообщения. Первым — уцелевший testid, вторым — контейнер с датой
     * (он же несёт текст), третьим — авторский класс.
     *
     * `~=`, А НЕ `=`: значение этого testid склеивается из списка токенов —
     * при выделении «выбрать всё» там оказывается «select-all selectable-text»,
     * а если у обёртки был свой testid, он приписывается спереди. Точное
     * совпадение такие случаи молча пропускает, и часть сообщений уходила бы в
     * CRM пустыми — без единой ошибки в логах.
     */
    text: [
      '[data-testid~="selectable-text"]',
      "[data-pre-plain-text] .copyable-text",
      ".copyable-text",
    ],
    /** Подпись с датой, временем и автором — единственный источник времени. */
    prePlain: "[data-pre-plain-text]",
    /** Шапка чата: имя собеседника — подсказка человеку при ручной привязке. */
    title: ["#main header span[title]", "#main header div[title]", "#main header h1"],
    /**
     * Поле ввода. Три независимые опоры: авторский класс обёртки, атрибут,
     * который ставит сам Lexical, и data-tab=10 (он выставляется императивно).
     * Разные по природе — значит одна правка вёрстки не убьёт все сразу.
     */
    composerField: [
      "#main footer div.lexical-rich-text-input [contenteditable='true'][role='textbox']",
      "#main footer [data-lexical-editor='true']",
      "#main footer [contenteditable='true'][data-tab='10']",
      "#main footer [contenteditable='true']",
    ],
    /**
     * Что вычищаем из выбранного текстового узла.
     *
     * ВАЖНО ПРО ЧАСЫ. Здесь их НЕТ, и это не упущение: от склейки текста с
     * часами («перезвоните16:04» — ошибка, которую мы ловили и в Telegram, и в
     * MAX) защищает не вычистка, а выбор узла. Первый селектор `text` указывает
     * на сам span с текстом, а часы и галочки лежат в СОСЕДНЕМ узле, то есть в
     * клон просто не попадают.
     *
     * Если сработает последний, самый широкий кандидат (`.copyable-text`), в
     * текст может попасть строка часов. Это осознанный размен: косметический
     * дефект в одной строке карточки дешевле, чем риск вырезать само сообщение
     * селектором «последний потомок» — а именно им пришлось бы ловить часы, не
     * зная точной вложенности. Точную вложенность покажет probe на живой
     * странице, и тогда сюда добавится нормальный селектор.
     */
    junk: ["[data-icon^='msg-']", "[data-testid~='quoted-message']"],
  }

  /** Действующие селекторы: встроенные плюс переопределения из конфига. */
  let SEL = { ...DEFAULTS }

  /**
   * Как часто сверяем, не сменился ли чат.
   *
   * У WhatsApp нет ни события навигации, ни смены адреса, поэтому опрос — но
   * дешёвый: одно `querySelector` по `#main [data-id]`. Основную работу и так
   * делает MutationObserver ядра; опрос страхует случай, когда разметка
   * поменялась без событий, которые наблюдатель успел бы схлопнуть.
   */
  const CHAT_POLL_MS = 500

  /** Сколько ждём реконсиляцию Lexical после вставки (он работает на микротаске). */
  const INSERT_TIMEOUT_MS = 500

  /**
   * Сколько последних строк просматриваем в поисках номера в подписи.
   *
   * Ограничение не косметическое: поиск зовётся на каждом такте наблюдателя, а в
   * открытом чате в DOM лежат сотни строк. Двадцати хватает с запасом — подпись
   * с номером есть у КАЖДОГО входящего от несохранённого контакта, а не у
   * какого-то одного.
   */
  const LABEL_SCAN_ROWS = 20

  // Content script в MV3 — классический скрипт, статический import невозможен.
  // Чистые модули подтягиваем динамически: они покрыты тестами и объявлены в
  // web_accessible_resources.
  /** @type {typeof import("../common/wa-jid.js") | null} */
  let waJid = null
  /** @type {typeof import("../common/wa-time.js") | null} */
  let waTime = null
  /** @type {typeof import("../common/selector-config.js") | null} */
  let selectorConfig = null

  /** Что сейчас с конфигом селекторов — строкой, для диагностики в ping. */
  let configState = "встроенные селекторы"

  /** Счётчики последнего сбора — показываются в диагностике панели. */
  let lastCollect = {
    всего: 0,
    взято: 0,
    служебных: 0,
    чужогоЧата: 0,
    безКлюча: 0,
    безВремени: 0,
    пустых: 0,
  }

  /**
   * Разбирается ли строка как CSS-селектор.
   *
   * Главная защита от опечатки в удалённом конфиге: невалидный селектор бросает
   * SyntaxError прямо в `querySelectorAll`, и механизм починки канала стал бы
   * способом сломать его сильнее.
   * @param {string} selector
   */
  function isValidSelector(selector) {
    try {
      document.createDocumentFragment().querySelector(selector)
      return true
    } catch {
      return false
    }
  }

  /**
   * Применить кэш удалённого конфига поверх встроенных селекторов.
   * Считаем от DEFAULTS каждый раз: конфиг может и УБРАТЬ переопределение.
   * @param {any} cached
   */
  function applySelectorConfig(cached) {
    if (!selectorConfig) return
    const overrides = selectorConfig.readChannelOverrides(cached, "whatsapp")
    const merged = selectorConfig.mergeSelectors(DEFAULTS, overrides, isValidSelector)
    SEL = merged.selectors
    if (!merged.applied.length && !merged.rejected.length) {
      // «Конфиг приехал и он пустой» и «конфиг не приезжал вовсе» выглядят
      // одинаково — работаем на встроенных, — но в первом случае механизм
      // починки жив, а во втором мёртв. Узнавать об этом в аварии поздно.
      configState = cached?.channels
        ? `встроенные селекторы (конфиг v${cached.version ?? "?"} пуст — это норма)`
        : "встроенные селекторы (конфиг не получен)"
      return
    }
    configState =
      `конфиг v${cached?.version ?? "?"}: ` +
      `применено [${merged.applied.join(", ") || "—"}]` +
      (merged.rejected.length ? `, ОТКЛОНЕНО [${merged.rejected.join(", ")}]` : "")
  }

  /**
   * Первый подошедший узел из списка селекторов.
   * @param {ParentNode} scope
   * @param {string|string[]} selector
   * @returns {HTMLElement|null}
   */
  function pick(scope, selector) {
    for (const one of Array.isArray(selector) ? selector : [selector]) {
      const node = scope.querySelector(one)
      if (node instanceof HTMLElement) return node
    }
    return null
  }

  /** Контейнер открытого чата, либо null (открыт список чатов). */
  function chatRoot() {
    const node = document.querySelector(SEL.root)
    return node instanceof HTMLElement ? node : null
  }

  /**
   * Направление сообщения — СТРОГО по классам, без правила «нет класса значит
   * входящее».
   *
   * Такое правило при переименовании модификатора молча превратило бы всю
   * исходящую переписку во входящую (этот урок уже стоил нам гарда в MAX), а
   * здесь оно вдобавок затянуло бы в карточку служебные строки: у них обоих
   * классов нет как раз потому, что это не сообщения.
   *
   * @param {HTMLElement} row
   * @returns {"incoming"|"outgoing"|null}
   */
  function readDirection(row) {
    if (row.querySelector(SEL.outgoing) || row.matches(SEL.outgoing)) return "outgoing"
    if (row.querySelector(SEL.incoming) || row.matches(SEL.incoming)) return "incoming"
    return null
  }

  /**
   * Идентификатор открытого чата — из `data-id` любой видимой строки.
   *
   * Другого источника НЕТ: единственный элемент, где WhatsApp выводит JID
   * отдельным атрибутом, — это чип упоминания @mention. Ни у шапки чата, ни у
   * строки списка чатов идентификатора нет, и все публичные скраперы,
   * перебирающие `#main header [data-chat-id]`, просто гадают.
   *
   * Берём ПОСЛЕДНЮЮ строку: при переключении чата новая лента дорисовывается, и
   * низ ленты обновляется первым.
   *
   * @returns {string|null} Нормализованный JID чата.
   */
  function readChatJid() {
    if (!waJid) return null
    const root = chatRoot()
    if (!root) return null
    const rows = root.querySelectorAll(SEL.row)
    for (let i = rows.length - 1; i >= 0; i--) {
      const id = rows[i].getAttribute("data-id")
      const key = waJid.parseMessageKey(id)
      if (key?.chatJid) return key.chatJid
    }
    return null
  }

  /**
   * Телефон собеседника из подписи ВХОДЯЩЕГО сообщения — запасной источник,
   * когда чат идёт под скрытым идентификатором и номера в JID нет.
   *
   * Откуда он там берётся: подпись собирается из имени контакта, а у
   * НЕсохранённого контакта именем служит международный номер. Лестница у
   * WhatsApp длиннее (сохранённое имя → название бизнеса → @username → номер),
   * поэтому строку обязательно классифицирует чистая функция: «не имя, значит
   * номер» дало бы в поле phone чей-то @ник, а сервер по нему пошёл бы искать
   * клиента ПО НОМЕРУ.
   *
   * Берём только у ВХОДЯЩИХ: в подписи исходящего стоит наше собственное имя.
   *
   * @param {HTMLElement} root
   * @returns {string|null}
   */
  function readPhoneFromIncomingLabel(root) {
    if (!waTime) return null
    const rows = root.querySelectorAll(SEL.row)
    // Смотрим только хвост ленты. Функция зовётся на каждом такте наблюдателя, а
    // в открытом чате в DOM лежат сотни строк — полный проход по ним ради
    // запасного источника номера был бы постоянной лишней работой в чужой
    // вкладке. Если в последних строках номера нет, его нет и смысла искать:
    // подпись с номером бывает у КАЖДОГО входящего несохранённого контакта.
    const scanFrom = Math.max(0, rows.length - LABEL_SCAN_ROWS)
    for (let i = rows.length - 1; i >= scanFrom; i--) {
      const row = /** @type {HTMLElement} */ (rows[i])
      if (readDirection(row) !== "incoming") continue
      const parsed = waTime.parsePrePlainText(
        row.querySelector(SEL.prePlain)?.getAttribute("data-pre-plain-text"),
      )
      const phone = waTime.phoneFromAuthorLabel(parsed?.author)
      if (phone) return phone
    }
    return null
  }

  /** Имя собеседника из шапки — подсказка при ручной привязке. */
  function readChatTitle() {
    const root = chatRoot() ?? document
    const node = pick(root, SEL.title)
    const title = node?.getAttribute("title") || node?.textContent
    return title?.trim() || null
  }

  /**
   * Текст сообщения без служебной обвязки.
   * @param {HTMLElement} row
   * @returns {string}
   */
  function readRowText(row) {
    const node = pick(row, SEL.text) ?? row
    return readCleanText(node, SEL.junk)
  }

  /**
   * Видимые сообщения открытого чата.
   *
   * КЛЮЧЕВОЕ ПРАВИЛО: берём только строки, чей `data-id` указывает на ТЕКУЩИЙ
   * чат. В MAX от смешения лент пришлось защищаться временным окном (разметка
   * прошлого диалога живёт ещё несколько кадров), здесь же каждое сообщение
   * приносит свой чат — и защита получается точной, а не по таймеру.
   *
   * @returns {ChatMessage[]}
   */
  function collectVisibleMessages() {
    lastCollect = {
      всего: 0,
      взято: 0,
      служебных: 0,
      чужогоЧата: 0,
      безКлюча: 0,
      безВремени: 0,
      пустых: 0,
    }
    if (!waJid || !waTime) return []

    const chat = readChat()
    // Групповые чаты и рассылки не собираем — первый из четырёх рубежей
    // (остальные: service worker, панель, сервер). Ни один убирать нельзя:
    // старая сборка расширения в браузере сотрудника переживает любой из них.
    if (!chat || chat.unsupported || !chat.chatId) return []

    const root = chatRoot()
    if (!root) return []

    const locale = document.documentElement.lang || undefined
    /** @type {ChatMessage[]} */
    const out = []
    /** Один и тот же id встречается дважды у альбомов: строка-обёртка и первый элемент. */
    const seen = new Set()

    for (const node of root.querySelectorAll(SEL.row)) {
      const row = /** @type {HTMLElement} */ (node)
      lastCollect.всего++

      const key = waJid.parseMessageKey(row.getAttribute("data-id"))
      if (!key) {
        lastCollect.безКлюча++
        continue
      }
      // Строка из другого чата — разметка соседнего диалога, ещё живущая в DOM.
      // Молча взять её значило бы записать чужую переписку в открытую карточку,
      // а уникальный ключ дедупа не даст потом её оттуда убрать.
      if (key.chatJid && key.chatJid !== chat.chatId) {
        lastCollect.чужогоЧата++
        continue
      }
      if (seen.has(key.messageId)) continue

      // Направление — оно же признак «это сообщение, а не служебная строка».
      // У уведомлений о шифровании, звонков и событий группы классов нет.
      const direction = readDirection(row)
      if (!direction) {
        lastCollect.служебных++
        continue
      }

      const text = readRowText(row)
      if (!text) {
        // Штатно: фото и стикеры без подписи после вычистки пустеют. А ещё так
        // выглядит строка, содержимое которой выгружено виртуализацией, — это
        // НЕ пустое сообщение, и заливать его нечем.
        lastCollect.пустых++
        continue
      }

      const sentAt = waTime.parseWhatsappSentAt(
        row.querySelector(SEL.prePlain)?.getAttribute("data-pre-plain-text"),
        locale,
      )
      // Времени может не быть — и это НЕ повод пропускать сообщение, в отличие
      // от MAX. Там время входило в синтетический ключ дедупа, и без него ключ
      // становился недетерминированным; здесь ключ настоящий, а время сервер
      // подставит своё (время заливки).
      if (!sentAt) lastCollect.безВремени++

      seen.add(key.messageId)
      out.push({ externalId: key.messageId, direction, text, sentAt })
    }

    // Только хвост: в ленте лежит вся подгруженная история, а заливать её
    // целиком в CRM нельзя — лента коммуникаций утонет в старой переписке.
    const tail = out.slice(-COLLECT_LIMIT)
    lastCollect.взято = tail.length
    return tail
  }

  /**
   * Отпечаток самого свежего сообщения: по нему ядро понимает, что пришло новое,
   * и будит панель.
   *
   * Берём id последней строки, а не количество строк: лента виртуализуется
   * построчно, и счётчик менялся бы на каждой прокрутке — панель бегала бы в
   * CRM без повода.
   *
   * @returns {string|null}
   */
  function readLatestMessageKey() {
    if (!waJid) return null
    const root = chatRoot()
    if (!root) return null
    const rows = root.querySelectorAll(SEL.row)
    for (let i = rows.length - 1; i >= 0; i--) {
      const key = waJid.parseMessageKey(rows[i].getAttribute("data-id"))
      if (key) return key.messageId
    }
    return null
  }

  /** Поле ввода: Lexical внутри подвала открытого чата. */
  function findComposer() {
    for (const selector of Array.isArray(SEL.composerField)
      ? SEL.composerField
      : [SEL.composerField]) {
      for (const node of document.querySelectorAll(selector)) {
        const el = /** @type {HTMLElement} */ (node)
        if (!el.isContentEditable) continue
        // offsetParent = null у скрытых элементов; getClientRects страхует
        // случай position: fixed, где offsetParent тоже null, но поле видно.
        if (el.offsetParent || el.getClientRects().length > 0) return el
      }
    }
    return null
  }

  /** Каретка в конец поля — вставляем в конец черновика, не затирая набранное. */
  function placeCaretAtEnd(el) {
    const selection = window.getSelection()
    if (!selection) return
    if (selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      return
    }
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /**
   * Видимый текст поля в сравнимом виде. У ПУСТОГО Lexical `innerText` равен
   * «\n», а не пустой строке — на этом уже спотыкался probe в MAX.
   * @param {HTMLElement} el
   */
  function visibleText(el) {
    return (el.innerText ?? "").replace(/\s+/g, " ").trim()
  }

  /**
   * Вставить текст в поле ввода — НЕ отправляя.
   *
   * Синтетический `paste`, как в MAX: WhatsApp сам слушает вставку, делает
   * preventDefault, читает clipboardData и раскладывает текст по абзацам —
   * причём проверки `isTrusted` у него нет. `execCommand` не используем даже
   * запасным путём: Lexical построен вокруг `beforeinput`, которого execCommand
   * в Chrome не порождает, и переносы строк теряются. Наполовину вставленный
   * текст в поле, откуда человек отправляет сообщение родителю, хуже честного
   * отказа — на отказ панель кладёт текст в буфер обмена.
   *
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function insertIntoComposer(text) {
    const el = findComposer()
    if (!el || !text) return false
    el.focus()
    placeCaretAtEnd(el)
    // Lexical подхватывает позицию каретки из DOM-выделения через
    // selectionchange, а не мгновенно — отдаём ему такт.
    await new Promise((resolve) => setTimeout(resolve, 30))

    const before = visibleText(el)
    const data = new DataTransfer()
    data.setData("text/plain", text)
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    )

    const deadline = Date.now() + INSERT_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      if (visibleText(el) !== before) return true
    }
    return false
  }

  /**
   * Открытый чат как контекст для панели.
   *
   * Неподдерживаемый чат отдаём ВМЕСТЕ с признаком `unsupported`, а не прячем:
   * панель должна объяснить человеку, почему карточки нет именно здесь.
   * Молчание он прочитает как поломку.
   *
   * @returns {ChatContext|null}
   */
  function readChat() {
    if (!waJid) return null
    const root = chatRoot()
    // Чат не открыт вовсе — список диалогов, настройки, стартовый экран.
    if (!root) return null

    const jid = readChatJid()
    if (!jid) {
      // Чат открыт, но идентификатора взять неоткуда: в нём ещё нет ни одного
      // сообщения либо все строки выгружены виртуализацией. Это НЕ поломка и не
      // «чат не выбран» — панель обязана сказать человеку правду.
      return {
        channel: "whatsapp",
        chatId: "",
        altIds: [],
        peerSource: "в чате нет сообщений",
        title: readChatTitle(),
        phone: null,
        unsupported: "no-messages",
      }
    }

    if (!waJid.isPersonalChatJid(jid)) {
      return {
        channel: "whatsapp",
        chatId: jid,
        altIds: [jid],
        peerSource: "не личный чат",
        title: readChatTitle(),
        phone: null,
        unsupported: "group",
      }
    }

    // Телефон отдаём ТОЛЬКО из того, что само себя объявило номером.
    //
    // Первый источник — JID, если он телефонный. Второй — подпись входящего
    // сообщения у несохранённого контакта. «Оставить цифры от LID» источником
    // НЕ является ни при каких условиях: за скрытым идентификатором стоит
    // внутренний номер WhatsApp, и поиск клиента по нему подставил бы в
    // карточку постороннего человека. Ровно эта мина уже сработала в MAX.
    const jidPhone = waJid.phoneFromJid(jid)
    const labelPhone = jidPhone ? null : readPhoneFromIncomingLabel(root)
    const phone = jidPhone ?? labelPhone

    return {
      channel: "whatsapp",
      chatId: jid,
      // Мешок идентификаторов: в WhatsApp он из одного значения — канон здесь
      // и есть сам JID. Поле шлём ради единого тракта с Telegram, где канон
      // приезжает из разметки отдельно от адреса.
      altIds: [jid],
      peerSource: jidPhone
        ? "номер из JID"
        : labelPhone
          ? "скрытый идентификатор, номер из подписи"
          : "скрытый идентификатор, номера нет",
      title: readChatTitle(),
      phone,
      unsupported: null,
    }
  }

  // Старт: сначала чистые модули (они покрыты тестами), потом описание канала
  // ядру. Разбор идентификаторов обязателен — без него мы не знаем, какой чат
  // открыт; разбор времени нет: без него переписка зальётся без времени, а не
  // потеряется.
  Promise.all([
    import(chrome.runtime.getURL("src/common/wa-jid.js")),
    import(chrome.runtime.getURL("src/common/wa-time.js")).catch(() => null),
    import(chrome.runtime.getURL("src/common/selector-config.js")).catch(() => null),
  ])
    .then(([jid, time, config]) => {
      waJid = jid
      waTime = time
      selectorConfig = config

      // Удалённый конфиг селекторов (§3 спеки). Кэш кладёт service worker, а мы
      // только читаем: content script в чужую страницу за сеть не ходит, да и
      // фоновый скрипт в MV3 спит — через storage связь надёжнее сообщений.
      if (selectorConfig) {
        const key = selectorConfig.SELECTOR_CONFIG_KEY
        try {
          chrome.storage.local
            .get(key)
            .then((stored) => applySelectorConfig(stored?.[key]))
            .catch(() => {})
          chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local" || !changes[key]) return
            applySelectorConfig(changes[key].newValue)
          })
        } catch {
          // Контекст расширения умер (обновили расширение) — работаем на
          // встроенных селекторах.
        }
      }

      core.start({
        channel: "whatsapp",
        ready: () => Boolean(waJid),
        readChat,
        collectMessages: collectVisibleMessages,
        latestMessageKey: readLatestMessageKey,
        insertText: insertIntoComposer,
        /**
         * Смена чата. Адрес не меняется вовсе, события навигации нет — значит
         * опрашиваем сам признак: JID последней строки. Наблюдатель DOM ядра
         * ловит это и сам, но у него дебаунс 300 мс и он молчит, если разметка
         * поменялась «внутри» одного кадра; опрос — дешёвая страховка.
         */
        watch: (onChange) => {
          let lastJid = readChatJid()
          const timer = setInterval(() => {
            const jid = readChatJid()
            if (jid === lastJid) return
            lastJid = jid
            onChange()
          }, CHAT_POLL_MS)
          return () => clearInterval(timer)
        },
        // Диагностика в ответе ping — её показывает строка в настройках панели.
        // Поломка разметки молчалива по устройству: панель продолжит рисовать
        // карточку, а переписка тихо перестанет заливаться.
        diag: () => ({
          чатОткрыт: Boolean(chatRoot()),
          строк: chatRoot()?.querySelectorAll(SEL.row).length ?? 0,
          сбор: lastCollect,
          селекторы: configState,
        }),
      })
    })
    .catch(() => {
      // Модуль не загрузился (крайне маловероятно — файл свой же). Панель
      // покажет «откройте чат»: лучше, чем сломанная страница мессенджера.
    })
})()
