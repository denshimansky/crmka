/**
 * Адаптер WhatsApp Web (web.whatsapp.com) — content script, isolated world.
 *
 * ЧТО ВАЖНО ЗНАТЬ ПРО WHATSAPP (docs/messenger-extension.md §8, Фаза 5).
 *
 * ВСЁ НИЖЕ — ИЗ ЖИВОГО ПРОГОНА 01.09.2026, а не из разбора бандла. Разбор
 * бандла дал три вывода, и живая страница опровергла ВСЕ ТРИ: `data-id`
 * оказался не сериализованным MsgKey, а голым идентификатором сообщения;
 * классов направления `message-in`/`message-out` в разметке нет вовсе;
 * `data-testid`, объявленные вырезанными, живы (490 штук). Мораль записана в
 * спеке: по WhatsApp верить можно только тому, что видно на живой странице.
 *
 *   • АДРЕС НЕ МЕНЯЕТСЯ при переключении чата: роутинга по чатам нет вовсе.
 *     Приёмы Telegram (хэш) и MAX (путь) здесь не работают;
 *   • ИДЕНТИФИКАТОРА ЧАТА В РАЗМЕТКЕ НЕТ НИ В КАКОМ ВИДЕ. Скан всех атрибутов
 *     всех элементов страницы не нашёл ни одного JID; `data-id` строки — это
 *     идентификатор СООБЩЕНИЯ («2A339FE00B7E3BFBC263»); строка списка чатов
 *     помечена порядковым `list-item-N`, который меняется при перестановке
 *     чатов. Единственная опора — ТЕЛЕФОН из заголовка чата, а он виден только
 *     у контактов, не сохранённых в телефонной книге. У сохранённых панель
 *     честно отказывается работать (см. readChat): имя идентификатором быть не
 *     может, два тёзки схлопнулись бы в одну карточку необратимо;
 *   • ЗАТО ИДЕНТИФИКАТОР СООБЩЕНИЯ НАСТОЯЩИЙ, и это подарок, которого не было в
 *     MAX: ключ дедупа не синтетический, поэтому правка сообщения не даёт
 *     вторую строку, а два одинаковых сообщения в минуту не схлопываются;
 *   • НАПРАВЛЕНИЕ — «хвостик» пузыря (`data-icon="tail-out"` / `tail-in`), но
 *     он рисуется ТОЛЬКО у первого сообщения в серии подряд идущих. Отсюда три
 *     признака в readDirection вместо одного;
 *   • СЛУЖЕБНЫЕ СТРОКИ отсеиваются структурно — по отсутствию контейнера
 *     пузыря, а не словарём формулировок, как пришлось в MAX;
 *   • ВРЕМЯ — только в `data-pre-plain-text` («[15:52, 31.08.2026] Имя: »),
 *     машинного unix-времени в разметке нет. Разбор — common/wa-time.js. У
 *     голосовых сообщений этого атрибута нет вовсе;
 *   • ГРУППЫ, РАССЫЛКИ, СТАТУСЫ И КАНАЛЫ панель НЕ ОБСЛУЖИВАЕТ. Сегодня они
 *     отсекаются тем же правилом, что и сохранённые контакты: у них в заголовке
 *     нет номера.
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
    /** Строка сообщения. Она же несёт идентификатор сообщения в `data-id`. */
    row: "[data-id]",
    /**
     * Признак «эта строка — сообщение, а не служебная».
     *
     * Раньше эту роль играло наличие классов направления, но живой прогон
     * показал, что классов `message-in`/`message-out` в разметке больше НЕТ
     * вовсе. Структурный признак теперь этот: у настоящего сообщения внутри
     * есть контейнер пузыря.
     */
    bubble: '[data-testid="msg-container"]',
    /**
     * Направление — «хвостик» пузыря.
     *
     * ВАЖНО: хвост рисуется ТОЛЬКО у первого сообщения в серии подряд идущих от
     * одного собеседника. У второго и последующих его нет вовсе — это видно в
     * живом отчёте, где из шести сообщений хвост был у четырёх. Поэтому одного
     * этого признака мало, см. readDirection.
     */
    tailOut: '[data-icon="tail-out"], [data-testid="tail-out"]',
    tailIn: '[data-icon="tail-in"], [data-testid="tail-in"]',
    /**
     * Подпись автора для программ чтения с экрана: «Вы:» у исходящего,
     * «<имя собеседника>:» у входящего. Есть даже там, где нет ни хвоста, ни
     * `data-pre-plain-text` (например, у голосовых сообщений).
     */
    author: "span[aria-label]",
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
    /**
     * Шапка чата: имя собеседника. Порядок выставлен по живому прогону —
     * `span[title]` не нашёлся вовсе, `div[title]` нашёлся с ПУСТЫМ текстом.
     * Рабочими оказались узел с `dir="auto"` внутри кнопки шапки и отдельный
     * testid заголовка.
     */
    title: [
      "#main header [role='button'] span[dir='auto']",
      '[data-testid="conversation-info-header-chat-title"]',
      '[data-testid="conversation-header"] span[dir="auto"]',
      "#main header span[title]",
    ],
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
   * Сколько ждём после смены чата, прежде чем собирать сообщения. См. settled().
   * Значение то же, что в адаптере MAX: там оно проверено живым прогоном.
   */
  const SETTLE_MS = 700

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
    безНаправления: 0,
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

  /** Заголовок, увиденный в прошлый раз, и момент, когда он сменился. */
  let lastTitle = null
  let titleChangedAt = Date.now()

  /**
   * Запомнить заголовок и засечь момент смены чата.
   * @param {string|null} title
   */
  function noteTitle(title) {
    if (title === lastTitle) return
    lastTitle = title
    titleChangedAt = Date.now()
  }

  /**
   * Прошёл ли «кадр перехода» после смены чата.
   *
   * ЗАЧЕМ. Идентификатор чата мы теперь берём из ЗАГОЛОВКА, а сообщения — из
   * ленты, и это два разных узла, которые могут обновиться не одновременно.
   * Если заголовок уже новый, а лента ещё старая, переписка прошлого
   * собеседника уедет в карточку нового — необратимо, уникальный ключ дедупа не
   * даст её оттуда убрать.
   *
   * Раньше в этом окне не было нужды: предполагалось, что каждое сообщение
   * несёт свой чат в `data-id`. Живой прогон показал, что не несёт, — и гонка,
   * ради которой в адаптере MAX заведён SETTLE_MS, вернулась сюда.
   *
   * Цена ожидания невелика: пропущенная заливка догоняется следующим сигналом
   * активности и кнопкой ⟳.
   */
  function settled() {
    return Date.now() - titleChangedAt > SETTLE_MS
  }

  /** Контейнер открытого чата, либо null (открыт список чатов). */
  function chatRoot() {
    const node = document.querySelector(SEL.root)
    return node instanceof HTMLElement ? node : null
  }

  /**
   * Направление сообщения. Три независимых признака, по убыванию надёжности.
   *
   * ПОЧЕМУ НЕ ОДИН. Живой прогон 01.09.2026 показал, что классов
   * `message-in`/`message-out`, на которые указывал разбор бандла, в разметке
   * нет вовсе, а «хвостик» пузыря рисуется ТОЛЬКО у первого сообщения в серии
   * подряд идущих от одного собеседника — из шести сообщений хвост был у
   * четырёх. Одного признака здесь физически не хватает.
   *
   *   1. Хвост пузыря — прямое и однозначное свидетельство.
   *   2. Подпись для программ чтения с экрана: «Вы:» либо «<имя собеседника>:».
   *      Сравниваем с ЗАГОЛОВКОМ ЧАТА, а не со словом «Вы»: в личном чате имя
   *      входящего собеседника и есть заголовок, и такое сравнение не зависит
   *      от языка интерфейса. Работает и там, где нет ни хвоста, ни времени
   *      (голосовые сообщения).
   *   3. Наследование от предыдущей строки. Хвост и означает начало серии,
   *      поэтому строка без хвоста продолжает направление предыдущей. Это
   *      вывод, а не наблюдение, — потому и последний.
   *
   * Если не сработало НИЧЕГО, возвращаем null и сообщение пропускаем. Правила
   * «нет признака — значит входящее» здесь нет и быть не должно: оно молча
   * превратило бы исходящую переписку во входящую, а это ложь в карточке
   * клиента, которую потом не отличить от правды.
   *
   * @param {HTMLElement} row
   * @param {string|null} title Заголовок чата — имя собеседника.
   * @param {"incoming"|"outgoing"|null} previous Направление предыдущей строки.
   * @returns {{direction: "incoming"|"outgoing"|null, source: string}}
   */
  function readDirection(row, title, previous) {
    if (row.querySelector(SEL.tailOut)) return { direction: "outgoing", source: "хвост" }
    if (row.querySelector(SEL.tailIn)) return { direction: "incoming", source: "хвост" }

    const author = readAuthorLabel(row)
    if (author) {
      const normalized = author.replace(/:$/, "").trim()
      if (title && normalized === title.trim()) return { direction: "incoming", source: "подпись" }
      // Подпись есть, но это не собеседник — значит писали мы.
      return { direction: "outgoing", source: "подпись" }
    }

    if (previous) return { direction: previous, source: "серия" }
    return { direction: null, source: "не определено" }
  }

  /**
   * Подпись автора из атрибута для программ чтения с экрана.
   *
   * Берём ПЕРВУЮ подпись, заканчивающуюся двоеточием: в строке есть и другие
   * (« Прочитано », «Воспроизвести голосовое сообщение»), а автор помечается
   * именно так — «Вы:» либо «Имя:».
   *
   * @param {HTMLElement} row
   * @returns {string|null}
   */
  function readAuthorLabel(row) {
    for (const node of row.querySelectorAll(SEL.author)) {
      const label = node.getAttribute("aria-label")?.trim()
      if (label && label.endsWith(":")) return label
    }
    return null
  }

  /**
   * ТЕЛЕФОН СОБЕСЕДНИКА — единственный идентификатор чата, который WhatsApp
   * отдаёт наружу.
   *
   * ЭТО ГЛАВНЫЙ ВЫВОД ЖИВОГО ПРОГОНА 01.09.2026, и он опровергает разбор
   * бандла. Идентификатора чата в разметке НЕТ НИ В КАКОМ ВИДЕ: скан всех
   * атрибутов всех элементов страницы не нашёл ни одного JID, а `data-id` у
   * строки сообщения оказался голым идентификатором СООБЩЕНИЯ («2A339FE0…»),
   * без чата и без направления. Строка списка чатов помечена лишь порядковым
   * `list-item-N`, который меняется при перестановке чатов.
   *
   * Остаётся ровно один источник: заголовок чата. У НЕсохранённого контакта
   * WhatsApp показывает там международный номер — это и есть настоящий,
   * устойчивый идентификатор. У сохранённого показывается имя из телефонной
   * книги, и тогда идентификатора нет вовсе.
   *
   * ИМЯ ИДЕНТИФИКАТОРОМ НЕ ДЕЛАЕМ. Соблазн велик — оно всегда есть, — но два
   * клиента с одинаковой подписью схлопнулись бы в одну карточку, а
   * переименование контакта рвало бы привязку. Ошибка при этом необратима:
   * уникальный ключ не даст убрать чужую переписку из карточки. Лучше честно
   * отказаться, чем тихо соврать.
   *
   * @param {string|null} title Заголовок чата.
   * @returns {string|null} Цифры номера либо null.
   */
  function phoneFromTitle(title) {
    if (!waTime) return null
    return waTime.phoneFromAuthorLabel(title)
  }

  /**
   * Телефон из подписи ВХОДЯЩЕГО сообщения — второй источник, на случай если
   * заголовок показывает имя, а подпись сообщения — номер.
   *
   * Такое бывает: заголовок и подпись строятся по разным лестницам
   * (сохранённое имя → название бизнеса → @username → номер). Строку
   * обязательно классифицирует чистая функция: «не имя, значит номер» дало бы в
   * поле phone чей-то @ник, а сервер по нему пошёл бы искать клиента ПО НОМЕРУ.
   *
   * Берём только у ВХОДЯЩИХ: в подписи исходящего стоит наше собственное имя.
   *
   * @param {HTMLElement} root
   * @param {string|null} title
   * @returns {string|null}
   */
  function readPhoneFromIncomingLabel(root, title) {
    if (!waTime) return null
    const rows = root.querySelectorAll(SEL.row)
    // Смотрим только хвост ленты. Функция зовётся на каждом такте наблюдателя, а
    // в открытом чате в DOM лежат сотни строк — полный проход по ним ради
    // запасного источника номера был бы постоянной лишней работой в чужой
    // вкладке. Если в последних строках номера нет, его нет и смысла искать:
    // подпись с номером бывает у КАЖДОГО входящего несохранённого контакта.
    const scanFrom = Math.max(0, rows.length - LABEL_SCAN_ROWS)
    let previous = null
    for (let i = scanFrom; i < rows.length; i++) {
      const row = /** @type {HTMLElement} */ (rows[i])
      const dir = readDirection(row, title, previous)
      previous = dir.direction ?? previous
      if (dir.direction !== "incoming") continue
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
      безНаправления: 0,
      безКлюча: 0,
      безВремени: 0,
      пустых: 0,
    }
    if (!waJid || !waTime) return []

    const chat = readChat()
    // Чат, который панель не обслуживает, не собираем — первый из четырёх
    // рубежей (остальные: service worker, панель, сервер). Ни один убирать
    // нельзя: старая сборка расширения в браузере сотрудника переживает любой
    // из них по отдельности.
    if (!chat || chat.unsupported || !chat.chatId) return []
    // Кадр перехода: заголовок мог уже смениться, а лента — ещё нет.
    if (!settled()) return []

    const root = chatRoot()
    if (!root) return []

    const locale = document.documentElement.lang || undefined
    const title = chat.title
    /** @type {ChatMessage[]} */
    const out = []
    /** Один и тот же id встречается дважды у альбомов: строка-обёртка и первый элемент. */
    const seen = new Set()
    /** Направление предыдущей строки — для серий без хвоста. */
    let previousDirection = null

    for (const node of root.querySelectorAll(SEL.row)) {
      const row = /** @type {HTMLElement} */ (node)
      lastCollect.всего++

      const key = waJid.parseMessageKey(row.getAttribute("data-id"))
      if (!key) {
        lastCollect.безКлюча++
        continue
      }
      // Служебная строка (уведомление о шифровании, событие, запись о звонке) —
      // у неё нет контейнера пузыря. Признак структурный, а не словарный: в MAX
      // пришлось отсеивать звонки перечислением формулировок, и этот словарь
      // протекает на каждой новой фразе мессенджера.
      if (!row.querySelector(SEL.bubble)) {
        lastCollect.служебных++
        continue
      }
      if (seen.has(key.messageId)) continue

      const dir = readDirection(row, title, previousDirection)
      if (!dir.direction) {
        lastCollect.безНаправления++
        continue
      }
      previousDirection = dir.direction
      const direction = dir.direction

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

    const title = readChatTitle()
    noteTitle(title)

    // Телефон — единственный идентификатор, который отдаёт разметка. Сначала
    // заголовок, потом подпись входящего сообщения: у несохранённого контакта
    // номер стоит и там, и там, но заголовок дешевле и надёжнее.
    const titlePhone = phoneFromTitle(title)
    const labelPhone = titlePhone ? null : readPhoneFromIncomingLabel(root, title)
    const phone = titlePhone ?? labelPhone

    if (!phone) {
      // Собеседник не опознаётся. Это НЕ поломка и не «чат не выбран»: WhatsApp
      // просто не выводит наружу ничего, что можно взять за идентификатор, —
      // ни JID, ни номера, — а имя из телефонной книги идентификатором быть не
      // может (см. phoneFromTitle). Панель обязана сказать это прямо.
      return {
        channel: "whatsapp",
        chatId: "",
        altIds: [],
        peerSource: "номер не виден: контакт сохранён в телефонной книге",
        title,
        phone: null,
        unsupported: "no-id",
      }
    }

    // Синтезируем канонический вид JID из номера. Так серверу не нужно ничего
    // знать про особенности WhatsApp Web: «79001234567@c.us» он нормализует в
    // тот же телефонный ключ, что и всегда, и матч по номеру работает как в
    // любом другом месте CRM.
    const chatId = `${phone}@c.us`

    return {
      channel: "whatsapp",
      chatId,
      // Мешок идентификаторов: здесь он из одного значения — канон и есть сам
      // номер. Поле шлём ради единого тракта с Telegram, где канон приезжает из
      // разметки отдельно от адреса.
      altIds: [chatId],
      peerSource: titlePhone ? "номер из заголовка чата" : "номер из подписи сообщения",
      title,
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
          // Опрашиваем ЗАГОЛОВОК: адрес не меняется вовсе, а идентификатор чата
          // выводится именно из него.
          let seen = readChatTitle()
          const timer = setInterval(() => {
            const title = readChatTitle()
            if (title === seen) return
            seen = title
            onChange()
          }, CHAT_POLL_MS)
          return () => clearInterval(timer)
        },
        // Диагностика в ответе ping — её показывает строка в настройках панели.
        // Поломка разметки молчалива по устройству: панель продолжит рисовать
        // карточку, а переписка тихо перестанет заливаться.
        diag: () => ({
          чатОткрыт: Boolean(chatRoot()),
          заголовок: readChatTitle(),
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
