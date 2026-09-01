/**
 * Probe разметки WhatsApp Web (web.whatsapp.com) — Шаг 1 Фазы 5,
 * docs/messenger-extension.md §8.
 *
 * ЗАЧЕМ. Урок Фазы 4 (MAX): адаптер, написанный по разбору бандла и по памяти,
 * промахивается ровно там, где это дороже всего — в ключе дедупа и в направлении
 * сообщения. Поэтому сначала факты, потом код. Этот скрипт собирает факты за
 * один прогон в консоли.
 *
 * ОТКУДА ВЗЯТЫ ОПОРЫ. Не из статей и не по памяти: разобран сам прод-бандл
 * WhatsApp Web (репозиторий vinikjkkj/wa-diff ежедневно выкачивает скрипты с
 * static.whatsapp.net и раскладывает по модулям). Отсюда и селекторы ниже.
 * Живой проверки при этом не было ни одной — её и делает этот probe.
 *
 * ЧТО ИЗВЕСТНО ИЗ КОДА (и что probe обязан подтвердить):
 *   • `#main` — контейнер открытого чата, id литеральный;
 *   • у строки сообщения есть `data-id` = сериализованный MsgKey:
 *     «fromMe _ JID чата _ id сообщения [_ self] [_ участник]». Если так и есть,
 *     ключ дедупа будет НАСТОЯЩИЙ, а не синтетический, как в MAX, и оба принятых
 *     там дефекта (правка = дубль, два одинаковых сообщения в минуту =
 *     схлопывание) в WhatsApp не появятся. ⚠️ Есть конфликт источников: полевые
 *     заметки стороннего скрапера (весна 2026) утверждают, что `data-id` стал
 *     ГОЛЫМ id сообщения без чата и направления. Код бандла этого не
 *     подтверждает. Снять это противоречие — задача №1 probe;
 *   • направление — авторские классы `message-in` / `message-out` на ВНУТРЕННЕМ
 *     div пузыря. Служебные строки (шифрование, звонки, события) — это те же
 *     строки с `data-id`, но БЕЗ обоих классов. Отсюда правило отбраковки:
 *     сообщение — только то, у чего есть класс направления;
 *   • дата и время — ТОЛЬКО в `data-pre-plain-text` («[16:04, 12.08.2026] Имя: »).
 *     Машинного unix-времени в разметке нет вовсе, формат зависит от языка
 *     интерфейса;
 *   • `data-testid` в чат-интерфейсе ВЫРЕЗАН на уровне сборки — все советы из
 *     интернета вида `[data-testid="conversation-compose-box-input"]` мертвы.
 *     Уцелел только `data-testid="selectable-text"` на самом тексте сообщения,
 *     и то потому, что собирается в рантайме;
 *   • поле ввода — Lexical (`div.lexical-rich-text-input` → contenteditable с
 *     `role="textbox"` и `data-tab="10"`), и он сам перехватывает `paste` без
 *     проверки isTrusted — значит способ вставки тот же, что отработан на MAX;
 *   • адрес страницы при смене чата НЕ меняется: роутинга по чатам в коде нет.
 *     Значит опрос адреса бесполезен, а chatId берётся только из разметки.
 *
 * ГЛАВНЫЙ ВОПРОС ВСЕГО ПРОГОНА: у ваших контактов JID в `data-id` — это ещё
 * номер («…@c.us») или уже скрытый идентификатор («…@lid»)? В бандле лежит целый
 * пласт миграции личных чатов на LID. Если у вас уже LID, автоматический поиск
 * клиента по телефону в WhatsApp не работает, и канал становится таким же
 * «ручным», как MAX.
 *
 * БЕЗОПАСНОСТЬ — читать буквально, здесь она строже, чем в MAX.
 *   • Скрипт ТОЛЬКО ЧИТАЕТ видимый DOM. Он не трогает localStorage и IndexedDB:
 *     в WhatsApp Web там лежат ключи сессии, дающие полный доступ к переписке;
 *   • НЕ ТРОГАЕМ window.Store / WPP / внутренние объекты страницы. Именно так
 *     работают whatsapp-web.js и wa-js — библиотеки автоматизации, за которые
 *     WhatsApp банит аккаунты. Наш путь принципиально другой: пассивное чтение
 *     того, что и так на экране;
 *   • НИЧЕГО НЕ ОТПРАВЛЯЕМ. Проверка вставки (`tryInsert`) кладёт текст в поле
 *     ввода и на этом останавливается; Enter не синтезируется никогда.
 *
 * КАК ЗАПУСКАТЬ.
 *   1. Открыть web.whatsapp.com (в РФ нужен VPN), войти, открыть ЛИЧНЫЙ чат, где
 *      есть переписка В ОБЕ СТОРОНЫ и хотя бы за два разных дня.
 *   2. F12 → Console → напечатать «allow pasting» → вставить весь файл → Enter.
 *   3. Отчёт ляжет в буфер обмена. Если нет: copy(JSON.stringify(crmkaWaProbe.last, null, 2))
 *   4. ПОВТОРИТЬ прогон, не перезагружая страницу, в других местах — формы
 *      идентификаторов там разные, и адаптер обязан их различать:
 *        • в ГРУППОВОМ чате              (ожидаем «@g.us»)
 *        • в чате «Сообщения себе»/«Избранное»
 *        • в СПИСКЕ чатов, не открыв ни одного (что видит адаптер в этот момент)
 *        • в архиве / в «Статусах» / в «Каналах», если они есть
 *      Каждый раз: crmkaWaProbe.rerun() и снова скопировать отчёт.
 *
 * ДОПОЛНИТЕЛЬНО (по одной команде за раз):
 *   crmkaWaProbe.rerun()            — пересобрать отчёт (после смены чата)
 *   crmkaWaProbe.jids()             — где именно в разметке лежат JID-ы
 *   crmkaWaProbe.composerDeep()     — из чего сделано поле ввода
 *   await crmkaWaProbe.tryInsert("paste") — рекомендуемый способ вставки
 *   await crmkaWaProbe.tryInsert("exec")  — телеграмный путь, для сравнения
 *   await crmkaWaProbe.scrollCheck()— виртуализируется ли лента
 *   crmkaWaProbe.watch()            — что появляется в DOM при новом сообщении
 *   crmkaWaProbe.stop()             — выключить наблюдатель
 */

;(() => {
  const MAX_TEXT = 200
  const TREE_DEPTH = 5

  /** Сколько узлов показываем в инвентарях — иначе отчёт не влезает в буфер. */
  const SAMPLE = 8

  const cut = (text) => {
    const value = (text ?? "").replace(/\s+/g, " ").trim()
    return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
  }

  const attrs = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, cut(a.value)]))

  /**
   * Классы WhatsApp Web обфусцированы («_akbu», «x1n2onr6» — там ещё и
   * atomic-CSS от Meta), но исторически рядом с ними живут ОСМЫСЛЕННЫЕ имена
   * («message-in», «message-out», «copyable-text», «selectable-text»). Отделяем
   * одно от другого: цепляться в адаптере можно только за осмысленные.
   */
  const isNoiseClass = (c) => /^(?:_[a-z0-9]{3,}|x[a-z0-9]{5,}|[a-z0-9]{6,})$/i.test(c) && !/-/.test(c)
  const classParts = (el) => [...el.classList].filter((c) => !isNoiseClass(c))
  const allClasses = (el) => [...el.classList]

  const describe = (el) =>
    el
      ? {
          tag: el.tagName.toLowerCase(),
          classes: classParts(el),
          всеКлассы: allClasses(el).length,
          attrs: attrs(el),
          text: cut(el.textContent),
        }
      : null

  /**
   * Компактное дерево узла: нужно, чтобы понять, ГДЕ внутри пузыря лежат текст,
   * время, галочки доставки, цитата и реакции — всё это придётся вычищать при
   * сборе текста, иначе в карточку клиента уедет «текст сообщения16:04✓✓».
   */
  const tree = (el, depth = 0) => {
    if (!el || depth > TREE_DEPTH) return null
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(" ")
    return {
      tag: el.tagName.toLowerCase(),
      classes: classParts(el),
      attrs: Object.fromEntries(Object.entries(attrs(el)).filter(([k]) => k !== "class")),
      ownText: cut(ownText) || undefined,
      children: [...el.children].slice(0, 10).map((child) => tree(child, depth + 1)),
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Обобщённые сканы: не полагаемся на то, что мы «знаем» селекторы
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Все JID-подобные строки во ВСЕХ атрибутах документа.
   *
   * Это главный инструмент отчёта. Вместо «проверим, есть ли data-id» мы
   * спрашиваем разметку: где вообще лежат идентификаторы WhatsApp и как они
   * выглядят. Так probe переживёт переименование атрибутов — а именно на этом
   * ломаются все известные библиотеки-скрейперы WhatsApp.
   *
   * Формы, которые ищем:
   *   <цифры>@c.us            — личный чат, номер телефона как есть
   *   <цифры>@s.whatsapp.net  — тот же номер, форма из протокола
   *   <цифры>@lid             — «скрытый» идентификатор (миграция 2025-2026),
   *                             номера за ним НЕТ
   *   <цифры>-<цифры>@g.us    — группа
   *   status@broadcast        — лента статусов
   *   <что-то>@broadcast      — список рассылки
   *   <что-то>@newsletter     — канал
   */
  // Подчёркивание в локальную часть НЕ включаем сознательно: значение data-id
  // выглядит как «false_79001234567@c.us_3EB0…», а класс \w (в него входит «_»)
  // захватывал бы префикс направления — в отчёт попадал бы «false_79001234567@c.us»
  // вместо самого JID. В идентификаторах WhatsApp подчёркивания не бывает.
  const JID_RE = /[A-Za-z0-9.:-]+@(?:c\.us|s\.whatsapp\.net|lid|g\.us|broadcast|newsletter)/gi

  function scanJids() {
    /** @type {Map<string, {атрибут: string, примеры: Set<string>, узлы: number, теги: Set<string>}>} */
    const byAttr = new Map()
    const виды = new Map()

    for (const el of document.querySelectorAll("*")) {
      for (const a of el.attributes) {
        const found = String(a.value).match(JID_RE)
        if (!found) continue
        const bucket =
          byAttr.get(a.name) ??
          byAttr.set(a.name, { атрибут: a.name, примеры: new Set(), узлы: 0, теги: new Set() }).get(a.name)
        bucket.узлы++
        bucket.теги.add(el.tagName.toLowerCase())
        for (const jid of found) {
          if (bucket.примеры.size < 6) bucket.примеры.add(jid)
          const kind = jid.split("@")[1].toLowerCase()
          виды.set(kind, (виды.get(kind) ?? 0) + 1)
        }
      }
    }

    return {
      подсказка:
        "Здесь видно, в каких атрибутах WhatsApp держит идентификаторы чатов. Именно за них будет цепляться адаптер.",
      поАтрибутам: [...byAttr.values()].map((b) => ({
        атрибут: b.атрибут,
        узлов: b.узлы,
        теги: [...b.теги],
        примеры: [...b.примеры],
      })),
      видыJid: Object.fromEntries(виды),
      естьLid: (виды.get("lid") ?? 0) > 0,
      естьНомер: (виды.get("c.us") ?? 0) + (виды.get("s.whatsapp.net") ?? 0) > 0,
    }
  }

  /**
   * Разбор конкретного значения data-id на части.
   *
   * Ожидаемая (по открытым источникам) форма: «<fromMe>_<chatJid>_<msgId>» и
   * «<fromMe>_<chatJid>_<msgId>_<participantJid>» в группах. Мы НЕ утверждаем
   * этого — мы показываем, на сколько частей строка делится и что в них лежит,
   * чтобы правило разбора писалось по факту.
   */
  function splitId(value) {
    const parts = String(value ?? "").split("_")
    return {
      исходная: cut(value),
      частей: parts.length,
      части: parts.map((p, i) => ({
        индекс: i,
        значение: cut(p),
        длина: p.length,
        похожеНа:
          /^(?:true|false)$/i.test(p)
            ? "флаг «моё сообщение»"
            : jidTest(p)
              ? "jid"
              : /^\d{10,}$/.test(p)
                ? "число (id или время?)"
                : /^[0-9A-F]{8,}$/i.test(p)
                  ? "hex-идентификатор"
                  : "прочее",
      })),
    }
  }
  // JID_RE глобальный — сбрасываем lastIndex, иначе .test() через раз врёт.
  const jidTest = (v) => {
    JID_RE.lastIndex = 0
    return JID_RE.test(String(v ?? ""))
  }

  /**
   * Всё, что похоже на ИДЕНТИФИКАТОР, в любых атрибутах документа.
   *
   * Зачем отдельно от scanJids: первый живой прогон показал, что JID-ов в
   * разметке нет ни одного. Значит искать надо шире — длинные числа, hex,
   * base64-подобные строки. По тому, в каких атрибутах они лежат и на каких
   * узлах, и будет видно, можно ли вообще опознать чат.
   *
   * Служебные атрибуты (class, style, ссылки, пути SVG) пропускаем: там
   * идентификаторов не бывает, а мусора много.
   */
  const SKIP_ATTRS = new Set(["class", "style", "src", "href", "d", "viewBox", "points", "transform"])
  const ID_SHAPES = [
    { имя: "hex-16+", re: /^[0-9A-F]{16,}$/i },
    { имя: "число-10+", re: /^\d{10,}$/ },
    { имя: "base64-20+", re: /^[A-Za-z0-9+/=_-]{20,}$/ },
  ]

  function scanIdLikeAttributes() {
    /** @type {Map<string, {атрибут: string, форма: string, узлов: number, примеры: Set<string>, теги: Set<string>, testid: Set<string>}>} */
    const found = new Map()

    for (const el of document.querySelectorAll("*")) {
      for (const a of el.attributes) {
        if (SKIP_ATTRS.has(a.name)) continue
        const value = String(a.value).trim()
        if (!value || value.length < 10) continue
        const shape = ID_SHAPES.find((s) => s.re.test(value))
        if (!shape) continue
        const key = `${a.name}|${shape.имя}`
        const bucket =
          found.get(key) ??
          found
            .set(key, {
              атрибут: a.name,
              форма: shape.имя,
              узлов: 0,
              примеры: new Set(),
              теги: new Set(),
              testid: new Set(),
            })
            .get(key)
        bucket.узлы = (bucket.узлы ?? 0) + 1
        bucket.узлов++
        bucket.теги.add(el.tagName.toLowerCase())
        if (bucket.примеры.size < 5) bucket.примеры.add(value)
        // Ближайший осмысленный контекст: по нему видно, это строка сообщения,
        // элемент списка чатов или что-то ещё.
        const holder = el.closest("[data-testid]")
        if (holder && bucket.testid.size < 5) bucket.testid.add(holder.getAttribute("data-testid"))
      }
    }

    return {
      подсказка:
        "Если чат чем-то идентифицируется, он здесь. Пусто — значит в разметке нет ничего, кроме отображаемого имени.",
      найдено: [...found.values()].map((b) => ({
        атрибут: b.атрибут,
        форма: b.форма,
        узлов: b.узлов,
        теги: [...b.теги],
        внутри: [...b.testid],
        примеры: [...b.примеры],
      })),
    }
  }

  /**
   * Список чатов слева: элементы, их атрибуты и признак активного.
   *
   * Идентификатор чата логичнее всего искать именно здесь — в строке списка. Она
   * помечена `data-testid="cell-frame-container"`, а сами элементы —
   * `list-item-N`. Заодно смотрим, чем помечен АКТИВНЫЙ чат: если ничем, то
   * определить открытый диалог через список тоже не выйдет.
   */
  function scanChatList() {
    const list = document.querySelector('[data-testid="chat-list"]') ?? document.querySelector("#pane-side")
    if (!list) return { естьСписок: false }

    const items = [...list.querySelectorAll('[data-testid^="list-item-"]')]
    const active = items.find(
      (el) =>
        el.getAttribute("aria-selected") === "true" ||
        el.getAttribute("aria-current") != null ||
        el.querySelector('[aria-selected="true"]'),
    )

    return {
      естьСписок: true,
      элементов: items.length,
      активныйНайден: Boolean(active),
      активный: active ? { ...describe(active), дерево: tree(active, 2) } : null,
      // Первые два элемента целиком: там видно, какие атрибуты вообще бывают.
      примеры: items.slice(0, 2).map((el) => ({ ...describe(el), дерево: tree(el, 2) })),
    }
  }

  /**
   * Атрибуты, похожие на время. Ищем и человекочитаемое («[16:04, 12.08.2026]»),
   * и машинное (unix-секунды/миллисекунды) — второе для нас ценнее, потому что
   * не зависит от языка интерфейса и от формата даты.
   */
  function scanTimes() {
    const человеческое = []
    const машинное = []
    const HUMAN = /\d{1,2}:\d{2}/
    const UNIX = /^\d{10}(?:\d{3})?$/

    for (const el of document.querySelectorAll("*")) {
      for (const a of el.attributes) {
        if (a.name === "class" || a.name === "style") continue
        const v = String(a.value)
        if (HUMAN.test(v) && человеческое.length < 12) {
          человеческое.push({
            атрибут: a.name,
            значение: cut(v),
            tag: el.tagName.toLowerCase(),
            classes: classParts(el),
          })
        }
        if (UNIX.test(v.trim()) && машинное.length < 12) {
          const n = Number(v.trim())
          const ms = n > 1e12 ? n : n * 1000
          машинное.push({
            атрибут: a.name,
            значение: v.trim(),
            какДата: new Date(ms).toISOString(),
            правдоподобно: ms > Date.parse("2015-01-01") && ms < Date.now() + 864e5,
            tag: el.tagName.toLowerCase(),
            classes: classParts(el),
          })
        }
      }
    }
    return {
      подсказка:
        "Если найдётся машинное время (unix) — берём его: оно не зависит от языка интерфейса. Иначе разбираем строку, как в MAX.",
      человеческое,
      машинное,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Сборка отчёта
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Поле ввода по опорам из прод-бандла: авторский класс
   * `lexical-rich-text-input`, `role="textbox"`, `data-tab="10"`. Ищем ВНУТРИ
   * `#main footer` — на странице есть и другие contenteditable (поиск, подпись
   * к медиа), и «первый попавшийся» ловил бы их.
   */
  function findComposer() {
    const selectors = [
      "#main footer div.lexical-rich-text-input [contenteditable='true'][role='textbox']",
      "#main footer [contenteditable='true'][data-tab='10']",
      "#main footer [contenteditable='true']",
      "[contenteditable='true'][role='textbox']",
    ]
    for (const selector of selectors) {
      const node = document.querySelector(selector)
      if (node instanceof HTMLElement && node.isContentEditable) return { node, selector }
    }
    return { node: null, selector: null }
  }

  /** Корень открытого диалога. Кандидаты — от самого осмысленного к общему. */
  function mainRoot() {
    const candidates = [
      "#main",
      "[data-testid='conversation-panel-wrapper']",
      "[data-testid='conversation-panel-messages']",
      "main",
      "[role='application']",
    ]
    for (const selector of candidates) {
      const node = document.querySelector(selector)
      if (node) return { selector, node }
    }
    return { selector: null, node: null }
  }

  /**
   * Узлы сообщений. Идём от самого специфичного признака (`data-id` внутри
   * открытого диалога) к общему, и ОБЯЗАТЕЛЬНО отчитываемся, какой сработал:
   * от этого зависит, что писать в адаптер.
   */
  function messageNodes(root) {
    const tries = [
      { selector: "div[data-id]", scope: root ?? document },
      { selector: "[data-id]", scope: root ?? document },
      { selector: "[role='row']", scope: root ?? document },
      { selector: ".message-in, .message-out", scope: root ?? document },
      { selector: "[data-id]", scope: document },
    ]
    for (const t of tries) {
      const nodes = [...t.scope.querySelectorAll(t.selector)]
      if (nodes.length) return { selector: t.selector, вОбластиДиалога: t.scope !== document, nodes }
    }
    return { selector: null, вОбластиДиалога: false, nodes: [] }
  }

  /** Направление сообщения — по осмысленным классам, если они ещё живы. */
  const dirOf = (el) => {
    const classes = allClasses(el).join(" ")
    const self = /(?:^|\s)message-out(?:\s|$)/.test(classes)
    const other = /(?:^|\s)message-in(?:\s|$)/.test(classes)
    if (self) return "исходящее"
    if (other) return "входящее"
    // Запасной признак: класс мог уехать на потомка или на предка.
    if (el.querySelector(".message-out")) return "исходящее (класс у потомка)"
    if (el.querySelector(".message-in")) return "входящее (класс у потомка)"
    if (el.closest(".message-out")) return "исходящее (класс у предка)"
    if (el.closest(".message-in")) return "входящее (класс у предка)"
    return "не определено"
  }

  function build() {
    /**
   * Поле ввода по опорам из прод-бандла: авторский класс lexical-rich-text-input,
   * role="textbox", data-tab=10. Ищем ВНУТРИ #main footer — на странице есть и
   * другие contenteditable (поиск, подпись к медиа), и «первый попавшийся» ловил
   * бы их.
   */
  const findComposer = () => {
    const selectors = [
      "#main footer div.lexical-rich-text-input [contenteditable='true'][role='textbox']",
      "#main footer [contenteditable='true'][data-tab='10']",
      "#main footer [contenteditable='true']",
      "[contenteditable='true'][role='textbox']",
    ]
    for (const selector of selectors) {
      const node = document.querySelector(selector)
      if (node && node.isContentEditable) return { node, selector }
    }
    return { node: null, selector: null }
  }
  const report = {}
    const { selector: rootSelector, node: root } = mainRoot()

    // ── 1. Адрес: меняется ли он при смене чата ──────────────────────────────
    // Это ПЕРВЫЙ вопрос ко всему probe. У Telegram чат в хэше, у MAX в пути. Если
    // здесь адрес постоянный, то весь детект чата придётся строить на разметке —
    // и опрос location, как в MAX, окажется бесполезен.
    report.url = {
      href: location.href,
      pathname: location.pathname,
      search: location.search || null,
      hash: location.hash || null,
      title: document.title,
      подсказка:
        "Сравните href в двух РАЗНЫХ чатах. Если он одинаковый — адрес для детекта чата не годится.",
    }

    // ── 2. Где лежат идентификаторы ──────────────────────────────────────────
    report.jids = scanJids()

    // ── 2.1. ЛЮБЫЕ идентификаторы, а не только JID ───────────────────────────
    //
    // Главный вопрос второго прогона. Первый показал, что JID-ов в разметке нет
    // ВООБЩЕ — ни одного. Значит идентификатор чата, если он вообще есть, лежит
    // в каком-то другом виде: длинным числом, hex-строкой, base64. Ищем всё, что
    // похоже на идентификатор, и смотрим, в каких атрибутах оно живёт.
    //
    // Если и здесь пусто — значит чат в разметке не идентифицируется ничем,
    // кроме отображаемого имени, и это меняет устройство всего канала.
    report.идентификаторы = scanIdLikeAttributes()

    // ── 2.2. Список чатов: там идентификатор был бы уместнее всего ───────────
    report.списокЧатов = scanChatList()

    // ── 2.3. Опорные узлы целиком ────────────────────────────────────────────
    // Полный набор атрибутов у #main, шапки и подвала: если чат чем-то помечен,
    // помечен он, скорее всего, здесь.
    report.опорныеУзлы = {
      main: describe(document.querySelector("#main")),
      header: describe(document.querySelector("#main header")),
      footer: describe(document.querySelector("#main footer")),
      панельСообщений: describe(document.querySelector('[data-testid="conversation-panel-messages"]')),
    }

    // ── 3. Открытый диалог ───────────────────────────────────────────────────
    const header = root?.querySelector("header") ?? document.querySelector("header")
    report.открытыйЧат = {
      корень: rootSelector,
      естьКорень: Boolean(root),
      шапка: describe(header),
      // Имя собеседника — подсказка человеку при ручной привязке. Кандидатов
      // несколько, потому что заголовок WhatsApp то span[title], то div[title].
      имяКандидаты: [
        // Порядок правлен по первому живому прогону: `span[title]` не нашёлся, а
        // `div[title]` нашёлся с ПУСТЫМ текстом — то есть оба негодны. Рабочим
        // оказался узел с `dir="auto"` внутри кнопки шапки.
        "#main header [role='button'] span[dir='auto']",
        '[data-testid="conversation-header"] span[dir="auto"]',
        '[data-testid="conversation-info-header-chat-title"]',
        "#main header span[title]",
        "#main header div[title]",
        "header h1",
      ].map((selector) => {
        const node = (root ?? document).querySelector(selector)
        return { selector, найдено: Boolean(node), text: node ? cut(node.textContent) : null }
      }),
      // JID-ы, видимые ВНУТРИ области диалога: именно из них адаптер будет
      // выбирать «чат открыт вот с этим человеком».
      jidВОбластиДиалога: root ? scopedJids(root) : null,
    }

    // ── 4. Сообщения ─────────────────────────────────────────────────────────
    const found = messageNodes(root)
    const nodes = found.nodes
    const withId = nodes.filter((el) => el.getAttribute("data-id"))
    const ins = nodes.filter((el) => dirOf(el).startsWith("входящее"))
    const outs = nodes.filter((el) => dirOf(el).startsWith("исходящее"))

    const sampleOf = (list, label) =>
      list.slice(-2).map((el) => ({
        направление: label,
        узел: describe(el),
        разборDataId: splitId(el.getAttribute("data-id")),
        дерево: tree(el),
        // Главный кандидат на источник времени: data-pre-plain-text вида
        // «[16:04, 12.08.2026] Имя: ». Если он есть — время и автор берутся
        // оттуда, и городить капсулы с датами, как в MAX, не придётся.
        prePlainText: [...el.querySelectorAll("[data-pre-plain-text]")]
          .slice(0, 2)
          .map((n) => n.getAttribute("data-pre-plain-text")),
        // Куда WhatsApp кладёт сам текст.
        //
        // Порядок кандидатов — по разбору прод-бандла (см. шапку). Класса
        // `.selectable-text` больше НЕТ: осталось только одноимённое значение
        // data-testid, которое пережило вырезалку testid'ов лишь потому, что
        // собирается в рантайме. Авторский класс рядом — `copyable-text`.
        // Советы из интернета вида [data-testid="msg-text"] проверяем последними:
        // по коду их в проде нет, и если вдруг найдутся — это важная новость.
        текстКандидаты: [
          "[data-testid='selectable-text']",
          "[data-pre-plain-text] .copyable-text",
          ".copyable-text",
          "span.selectable-text",
          "[data-testid='msg-text']",
        ].map((selector) => {
          const n = el.querySelector(selector)
          return { selector, найдено: Boolean(n), text: n ? cut(n.textContent) : null }
        }),
        // Что придётся вычищать: часы, галочки доставки, цитата, реакции,
        // «переслано», подпись к файлу.
        подсказкиВремени: [...el.querySelectorAll("[title],[aria-label],[datetime],[data-pre-plain-text]")]
          .slice(0, 6)
          .map((n) => ({
            tag: n.tagName.toLowerCase(),
            classes: classParts(n),
            title: n.getAttribute("title"),
            aria: n.getAttribute("aria-label"),
            datetime: n.getAttribute("datetime"),
            pre: n.getAttribute("data-pre-plain-text"),
          })),
      }))

    report.сообщения = {
      selector: found.selector,
      вОбластиДиалога: found.вОбластиДиалога,
      всего: nodes.length,
      сDataId: withId.length,
      входящих: ins.length,
      исходящих: outs.length,
      неопределённых: nodes.length - ins.length - outs.length,
      направлениеПоКлассам: {
        messageIn: document.querySelectorAll(".message-in").length,
        messageOut: document.querySelectorAll(".message-out").length,
        подсказка:
          "Ноль в обоих — осмысленные классы направления убрали, и адаптеру нужен другой признак (первый сегмент data-id: true/false).",
      },
      // Примеры берём и по направлениям, и ПРОСТО ПОСЛЕДНИЕ строки.
      //
      // Первый прогон (01.09.2026) показал, почему второе обязательно: классов
      // направления в разметке не оказалось вовсе, списки ins/outs вышли
      // пустыми — и отчёт остался БЕЗ ЕДИНОГО дерева строки, то есть без самого
      // ценного. Выборка не должна зависеть от того, сработала ли наша догадка.
      примеры: [
        ...sampleOf(ins, "входящее"),
        ...sampleOf(outs, "исходящее"),
        ...sampleOf(nodes.slice(-3), "последние строки, без разбора направления"),
      ],
    }

    // ── 5. Время ─────────────────────────────────────────────────────────────
    report.время = scanTimes()
    report.время.prePlainTextВсего = document.querySelectorAll("[data-pre-plain-text]").length
    report.время.prePlainTextПримеры = [...document.querySelectorAll("[data-pre-plain-text]")]
      .slice(-4)
      .map((n) => n.getAttribute("data-pre-plain-text"))

    // ── 6. Служебные строки ──────────────────────────────────────────────────
    // В ленте, кроме сообщений, живут: разделители дат, «Сообщения защищены
    // сквозным шифрованием», «Непрочитанные сообщения», уведомления о звонках,
    // системные строки о смене номера. Если они окажутся такими же узлами, как
    // сообщения, наивный сбор утащит их в карточку клиента как реплики родителя.
    const listRoot = nodes[0]?.parentElement ?? null
    report.служебныеСтроки = {
      контейнерЛенты: describe(listRoot),
      чужиеУзлы: listRoot
        ? [...listRoot.children]
            .filter((el) => !el.getAttribute("data-id"))
            .slice(0, SAMPLE)
            .map((el) => ({ ...describe(el), дерево: tree(el, TREE_DEPTH - 2) }))
        : [],
      подсказка:
        "Нужен СТРУКТУРНЫЙ признак служебной строки (отсутствие data-id, role, класс). Словарь по тексту — как в MAX — временная мера, которая протекает.",
    }

    // ── 6.5. Строки ленты, которые НЕ сообщения ──────────────────────────────
    // По коду бандла типы строк такие: msg, album (несколько сообщений в одной
    // строке!), date (разделитель дат), unread (разделитель непрочитанного),
    // botPluginCarousel, historyBundleInfo. Служебные пузыри — это те же строки
    // с data-id, но без классов направления: оба гасятся флагом isNotification.
    // Отсюда главное правило отбраковки в адаптере, и его надо подтвердить.
    report.типыСтрок = {
      всегоСDataId: nodes.filter((el) => el.getAttribute("data-id")).length,
      сНаправлением: nodes.filter((el) => dirOf(el) !== "не определено").length,
      безНаправления: nodes
        .filter((el) => dirOf(el) === "не определено")
        .slice(0, 6)
        .map((el) => ({ dataId: el.getAttribute("data-id"), text: cut(el.textContent) })),
      // Строк с несколькими data-id внутри быть не должно — если есть, это
      // альбом, и на одну строку приходится несколько сообщений.
      строкиСНесколькимиId: nodes.filter((el) => el.querySelectorAll("[data-id]").length > 1).length,
      // ЧЕМ ОТЛИЧАЮТСЯ ВХОДЯЩИЕ ОТ ИСХОДЯЩИХ, если классов направления нет.
      // Первый прогон показал в строках `data-icon="tail-out"` и значки статуса
      // доставки («wds-ic-read», «wds-ic-delivered») — они бывают только у
      // исходящих. Здесь собираем всё, чем строки вообще помечены, чтобы
      // выбрать признак не наугад.
      признакиНаправления: nodes.slice(-6).map((el) => ({
        dataId: el.getAttribute("data-id"),
        значки: [...el.querySelectorAll("[data-icon]")].map((n) => n.getAttribute("data-icon")),
        testid: [...el.querySelectorAll("[data-testid]")]
          .slice(0, 6)
          .map((n) => n.getAttribute("data-testid")),
        ariaLabel: el.getAttribute("aria-label"),
        классыСтроки: classParts(el),
        классыПотомков: [
          ...new Set(
            [...el.querySelectorAll("*")].flatMap((n) => classParts(n)),
          ),
        ].slice(0, 12),
      })),
      // Виртуализация: содержимое строки размонтируется, оставляя пустой узел.
      // Пустая строка — это НЕ пустое сообщение, и путать их нельзя.
      виртуализованных: document.querySelectorAll("[data-virtualized]").length,
      виртуализованныеЗначения: [
        ...new Set(
          [...document.querySelectorAll("[data-virtualized]")]
            .slice(0, 20)
            .map((n) => n.getAttribute("data-virtualized")),
        ),
      ],
      // role="row" появляется только при включённом A/B-гейте доступности.
      // Почти все публичные скраперы цепляются за него — нам важно знать, есть
      // ли он у нас, но опираться на него нельзя.
      строкRole: (root ?? document).querySelectorAll("[role='row']").length,
      // Контейнер списка сообщений (TAB_ORDER.MESSAGE_LIST = 8).
      списокСообщений: describe((root ?? document).querySelector("[data-tab='8']")),
    }

    // ── 7. Поле ввода ────────────────────────────────────────────────────────
    // По коду это Lexical: div.lexical-rich-text-input → ContentEditable с
    // role="textbox" и data-tab, выставленным императивно. У кнопки отправки
    // data-tab="11" — её НЕ ТРОГАТЬ ВООБЩЕ.
    const footer = document.querySelector("#main footer") ?? document.querySelector("footer")
    report.полеВвода = {
      подвал: describe(footer),
      contenteditable: [...document.querySelectorAll("[contenteditable]")].map((el) => ({
        ...describe(el),
        isContentEditable: el.isContentEditable,
        lexical: el.dataset?.lexicalEditor === "true",
        draftjs: Boolean(el.querySelector("[data-offset-key]")) || Boolean(el.closest(".DraftEditor-root")),
        dataTab: el.getAttribute("data-tab"),
        role: el.getAttribute("role"),
        вПодвале: Boolean(footer && footer.contains(el)),
      })),
      // Кандидаты из разбора бандла — проверяем, какой из них живой.
      кандидатыПоля: [
        "#main footer div.lexical-rich-text-input [contenteditable='true'][role='textbox']",
        "#main footer [contenteditable='true'][data-tab='10']",
        "#main footer [contenteditable='true']",
        "div.lexical-rich-text-input",
      ].map((selector) => {
        const n = document.querySelector(selector)
        return { selector, найдено: Boolean(n), dataTab: n?.getAttribute?.("data-tab") ?? null }
      }),
      // Кнопку отправки НЕ трогаем и не нажимаем — только смотрим, что она есть
      // (по ней проверяется, принял ли редактор вставку).
      кнопкаОтправки: [
        "#main footer [data-tab='11']",
        "span[data-icon='send']",
        "footer button[aria-label]",
      ].map((selector) => {
        const n = document.querySelector(selector)
        return { selector, найдено: Boolean(n), aria: n?.getAttribute?.("aria-label") ?? null }
      }),
      // Значения data-tab по всей странице: это единственный «семантический»
      // атрибут, переживший вырезание data-testid, и по нему удобно ставить
      // опоры (8 — лента сообщений, 10 — поле ввода, 11 — отправка, 6 — шапка).
      значенияDataTab: [
        ...new Set([...document.querySelectorAll("[data-tab]")].map((n) => n.getAttribute("data-tab"))),
      ].sort(),
    }

    // ── 8. Стабильные опоры ──────────────────────────────────────────────────
    // data-testid WhatsApp массово выпиливал — важно знать, что осталось.
    report.опоры = {
      testIds: [...new Set([...document.querySelectorAll("[data-testid]")].map((el) => el.getAttribute("data-testid")))].slice(0, 60),
      testIdВсего: document.querySelectorAll("[data-testid]").length,
      dataIcon: [...new Set([...document.querySelectorAll("[data-icon]")].map((el) => el.getAttribute("data-icon")))].slice(0, 40),
      осмысленныеКлассы: [...new Set([...document.querySelectorAll("[class]")].flatMap((el) => classParts(el)))]
        .filter((c) => /message|copyable|selectable|chat|bubble|quoted|reply|meta/i.test(c))
        .slice(0, 40),
    }

    // ── 9. Контейнер прокрутки ───────────────────────────────────────────────
    const findScroller = (from) => {
      let node = from?.parentElement ?? null
      while (node && node !== document.body) {
        if (node.scrollHeight > node.clientHeight + 8) return node
        node = node.parentElement
      }
      return document.scrollingElement
    }
    const scroller = findScroller(nodes[0])
    report.контейнерПрокрутки = scroller
      ? { ...describe(scroller), scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight }
      : null

    report._мета = {
      версияProbe: 1,
      снято: new Date().toISOString(),
      язык: document.documentElement.lang || null,
      подсказкаЯзыка:
        "Формат даты в data-pre-plain-text зависит от языка интерфейса — запишите, какой язык стоял.",
    }

    return { report, scroller, messageSelector: found.selector }
  }

  /** JID-ы в пределах узла — тот же скан, но суженный до открытого диалога. */
  function scopedJids(root) {
    const out = new Map()
    for (const el of root.querySelectorAll("*")) {
      for (const a of el.attributes) {
        const found = String(a.value).match(JID_RE)
        if (!found) continue
        for (const jid of found) out.set(jid, (out.get(jid) ?? 0) + 1)
      }
    }
    return [...out.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([jid, count]) => ({ jid, вхождений: count, вид: jid.split("@")[1] }))
  }

  let built = build()

  const api = {
    last: built.report,

    /** Пересобрать отчёт — после перехода в другой чат, БЕЗ перезагрузки страницы. */
    rerun() {
      built = build()
      api.last = built.report
      console.log("%c[wa-probe] отчёт пересобран", "font-weight:bold", built.report)
      try {
        copy(JSON.stringify(built.report, null, 2))
        console.log("[wa-probe] отчёт скопирован в буфер обмена")
      } catch {
        console.log("[wa-probe] буфер недоступен — выполните: copy(JSON.stringify(crmkaWaProbe.last, null, 2))")
      }
      return built.report
    },

    /** Только скан идентификаторов — быстрая проверка «а есть ли тут LID». */
    jids: () => scanJids(),

    /** Из чего сделано поле ввода: без этого способ вставки не выбрать. */
    composerDeep() {
      const { node: target, selector } = findComposer()
      if (!target) return "поле ввода не найдено — вероятно, чат не открыт"
      console.log("[wa-probe] поле ввода найдено по селектору:", selector)
      return {
        поле: describe(target),
        роднёй: {
          lexical: target.dataset?.lexicalEditor === "true",
          draftjs: Boolean(target.querySelector("[data-offset-key]")),
          slate: Boolean(target.querySelector("[data-slate-node]")),
          proseMirror: target.classList.contains("ProseMirror"),
        },
        дерево: tree(target, 3),
        предки: (() => {
          const out = []
          let node = target.parentElement
          for (let i = 0; node && i < 5; i++, node = node.parentElement) out.push(describe(node))
          return out
        })(),
      }
    },

    /**
     * Какой способ вставки принимает редактор WhatsApp.
     *
     * Урок MAX: `execCommand` в Chrome НЕ порождает `beforeinput`, а современные
     * редакторы (Lexical, Draft.js) построены вокруг него. Одиночный insertText
     * может пройти, а перенос строки — потеряться, и в поле окажется склеенный
     * текст. Синтетический `paste` перехватывается редактором штатно и обычно
     * работает целиком.
     *
     * ВНИМАНИЕ: текст появится в поле ввода — Enter НЕ нажимать, стереть руками.
     * Ничего не отправляется. Синтезировать keydown Enter в отладке КАТЕГОРИЧЕСКИ
     * нельзя: это обработчик отправки, и isTrusted он не проверяет.
     *
     * @param {"paste"|"exec"} способ
     */
    async tryInsert(способ = "paste", text = "строка один\nстрока два") {
      const { node: target } = findComposer()
      if (!target) return "поле ввода не найдено — сначала crmkaWaProbe.composerDeep()"

      // Кнопку отправки только НАБЛЮДАЕМ. По коду у неё data-tab="11"; её
      // появление — единственный честный признак, что редактор принял ввод
      // (Lexical реконсилирует DOM на микротаске, и мгновенное чтение текста
      // врёт). Нажимать её и синтезировать Enter — категорически нельзя.
      const sendBtn =
        document.querySelector("#main footer [data-tab='11']") ??
        document.querySelector("span[data-icon='send']")?.closest("button") ??
        document.querySelector("#main footer button[aria-label]")
      const снимок = () => ({
        текст: target.innerText ?? "",
        кнопкаОтправкиВидна: Boolean(sendBtn && sendBtn.offsetParent !== null),
      })

      target.focus()
      const selection = window.getSelection()
      if (selection) {
        const range = document.createRange()
        range.selectNodeContents(target)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
      await new Promise((r) => setTimeout(r, 50))

      const было = снимок()

      if (способ === "paste") {
        const dt = new DataTransfer()
        dt.setData("text/plain", text)
        target.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
        )
      } else {
        text.split("\n").forEach((line, index) => {
          if (index > 0) document.execCommand("insertLineBreak")
          if (line) document.execCommand("insertText", false, line)
        })
      }

      // Ждём реконсиляцию редактора: синхронная проверка соврёт.
      const крайний = Date.now() + 500
      let стало = снимок()
      while (Date.now() < крайний && стало.текст === было.текст) {
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        стало = снимок()
      }

      const вставлено = стало.текст.startsWith(было.текст)
        ? стало.текст.slice(было.текст.length)
        : стало.текст
      return {
        способ,
        было,
        стало,
        вставлено,
        переносСохранён: вставлено.includes("\n"),
        // Двойной перенос = редактор сделал АБЗАЦЫ. На экране выглядит так же, а
        // в отправленном сообщении между строками окажется пустая строка.
        абзацыВместоПереносов: вставлено.includes("\n\n"),
        подсказка:
          "Стереть текст руками. Признак настоящего успеха — появилась кнопка отправки: символы на экране без неё означают, что редактор ввод НЕ принял.",
      }
    },

    /**
     * Виртуализируется ли лента.
     *
     * Толковать осторожно: в коротком чате прокручивать нечего, и счётчик не
     * меняется ровно так же, как при виртуализации. Запускать в чате с ДЛИННОЙ
     * историей.
     */
    scrollCheck() {
      const box = built.scroller ?? document.scrollingElement
      const sel = built.messageSelector ?? "[data-id]"
      if (!box) return "Контейнер прокрутки не найден"
      const before = document.querySelectorAll(sel).length
      const scrollTopБыл = box.scrollTop
      const прокручиваемо = box.scrollHeight - box.clientHeight
      box.scrollTop = 0
      return new Promise((resolve) =>
        setTimeout(() => {
          const after = document.querySelectorAll(sel).length
          const прокруткаБыла = scrollTopБыл > 0 || прокручиваемо > 8
          resolve({
            selector: sel,
            доПрокрутки: before,
            после: after,
            прокручиваемоПиксели: прокручиваемо,
            вывод: !прокруткаБыла
              ? "НЕИНФОРМАТИВНО: прокручивать нечего. Нужен чат с длинной перепиской"
              : after > before
                ? "узлы накапливаются — виртуализации нет"
                : after < before
                  ? "виртуализация: часть узлов выгружена"
                  : "история докручена и не выросла — вероятно, виртуализации нет",
          })
        }, 1500),
      )
    },

    /**
     * Что появляется в DOM при новом сообщении.
     *
     * Нужно для двух решений адаптера: (1) хватает ли MutationObserver на body,
     * (2) приходит ли сообщение сразу с настоящим data-id или сначала с
     * временным (в Telegram временный id давал вторую строку в карточке).
     */
    watch() {
      const sel = built.messageSelector ?? "[data-id]"
      const seen = new Set([...document.querySelectorAll(sel)].map((el) => el.getAttribute("data-id") ?? cut(el.textContent)))
      const observer = new MutationObserver(() => {
        for (const el of document.querySelectorAll(sel)) {
          const key = el.getAttribute("data-id") ?? cut(el.textContent)
          if (seen.has(key)) continue
          seen.add(key)
          console.log("[wa-probe] новое сообщение:", {
            dataId: el.getAttribute("data-id"),
            разбор: splitId(el.getAttribute("data-id")),
            направление: dirOf(el),
            text: cut(el.textContent),
            prePlain: el.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") ?? null,
          })
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      api._observer = observer
      console.log(
        "[wa-probe] наблюдатель включён. Напишите себе сообщение из телефона и посмотрите вывод. Выключить: crmkaWaProbe.stop()",
      )
      return "жду новое сообщение…"
    },

    stop() {
      api._observer?.disconnect()
      return "наблюдатель выключен"
    },
  }

  window.crmkaWaProbe = api
  console.log("%c[wa-probe v1] отчёт", "font-weight:bold", built.report)
  console.log(
    "%c[wa-probe] дальше: crmkaWaProbe.rerun() в ГРУППЕ, потом await crmkaWaProbe.tryInsert('paste')",
    "color:#888",
  )
  try {
    copy(JSON.stringify(built.report, null, 2))
    console.log("[wa-probe] отчёт скопирован в буфер обмена")
  } catch {
    console.log("[wa-probe] буфер недоступен — выполните: copy(JSON.stringify(crmkaWaProbe.last, null, 2))")
  }
  return built.report
})()
