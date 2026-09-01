/**
 * Probe разметки WhatsApp Web (web.whatsapp.com) — Шаг 1 Фазы 5,
 * docs/messenger-extension.md §8.
 *
 * ЗАЧЕМ. Урок Фазы 4 (MAX): адаптер, написанный по разбору бандла и по памяти,
 * промахивается ровно там, где это дороже всего — в ключе дедупа и в направлении
 * сообщения. Поэтому сначала факты, потом код. Этот скрипт собирает факты за
 * один прогон в консоли.
 *
 * ЧЕМ WHATSAPP ОТЛИЧАЕТСЯ ОТ MAX И TELEGRAM (и что здесь главное проверить):
 *   • у сообщений, по всем признакам, ЕСТЬ настоящий идентификатор — атрибут
 *     `data-id` вида «false_79001234567@c.us_3EB0C767D26B8D...». Если это
 *     подтвердится, ключ дедупа будет НАСТОЯЩИЙ, а не синтетический, как в MAX,
 *     и оба принятых там дефекта (правка = дубль, два одинаковых сообщения в
 *     минуту = схлопывание) в WhatsApp не появятся;
 *   • в том же `data-id` лежит JID собеседника — а значит, ТЕЛЕФОН. Это
 *     единственный наш канал, где клиент может находиться автоматически, без
 *     ручной привязки. Но: WhatsApp с 2025 переводит пользователей на LID
 *     («<число>@lid») вместо номера, и насколько это уже случилось — вопрос
 *     номер один к этому probe;
 *   • адрес страницы, скорее всего, НЕ меняется при переключении чата (в отличие
 *     от Telegram с его хэшем и MAX с путём). Тогда «какой чат открыт» придётся
 *     читать только из разметки, а опрос адреса бесполезен. Проверяем явно.
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

    // ── 3. Открытый диалог ───────────────────────────────────────────────────
    const header = root?.querySelector("header") ?? document.querySelector("header")
    report.открытыйЧат = {
      корень: rootSelector,
      естьКорень: Boolean(root),
      шапка: describe(header),
      // Имя собеседника — подсказка человеку при ручной привязке. Кандидатов
      // несколько, потому что заголовок WhatsApp то span[title], то div[title].
      имяКандидаты: [
        "header span[title]",
        "header div[title]",
        "header [role='button'] span[dir='auto']",
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
        текстКандидаты: [
          "span.selectable-text",
          ".copyable-text .selectable-text",
          "[data-testid='msg-text']",
          ".selectable-text",
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
      примеры: [...sampleOf(ins, "входящее"), ...sampleOf(outs, "исходящее")],
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

    // ── 7. Поле ввода ────────────────────────────────────────────────────────
    // WhatsApp Web — React с собственным редактором (исторически Draft.js,
    // сейчас, возможно, Lexical). От того, ЧТО там, зависит способ вставки:
    // execCommand склеивает строки у Lexical (проверено на MAX).
    const footer = document.querySelector("footer") ?? document.querySelector("[data-testid='compose-box']")
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
      кнопкаОтправки: [
        "footer button[aria-label]",
        "[data-testid='send']",
        "span[data-icon='send']",
      ].map((selector) => {
        const n = document.querySelector(selector)
        return { selector, найдено: Boolean(n), aria: n?.getAttribute?.("aria-label") ?? null }
      }),
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
      const footer = document.querySelector("footer")
      const editable = [...document.querySelectorAll("[contenteditable]")].filter(
        (el) => el.isContentEditable && (!footer || footer.contains(el)),
      )
      const target = editable[0] ?? document.querySelector("[contenteditable]")
      if (!target) return "поле ввода не найдено — вероятно, чат не открыт"
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
      const footer = document.querySelector("footer")
      const target = [...document.querySelectorAll("[contenteditable]")].find(
        (el) => el.isContentEditable && (!footer || footer.contains(el)),
      )
      if (!target) return "поле ввода не найдено — сначала crmkaWaProbe.composerDeep()"

      const sendBtn =
        document.querySelector("span[data-icon='send']")?.closest("button") ??
        document.querySelector("footer button[aria-label]")
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
