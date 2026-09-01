/**
 * Probe разметки сообщений ВКонтакте — Шаг 1 Фазы 6,
 * docs/messenger-extension.md §8.
 *
 * ЗАЧЕМ. Урок Фазы 5 (WhatsApp) стоил переписанного адаптера: опоры были взяты
 * из прод-бандла, разобраны построчно, подтверждены адверсарной сверкой — и
 * живая страница опровергла ТРИ вывода из трёх. Правило с тех пор простое:
 * сначала факты с живой страницы, потом код. Этот скрипт собирает факты за один
 * прогон в консоли и кладёт отчёт в буфер обмена.
 *
 * ЧЕМ ВК ЛЕГЧЕ ПРЕДЫДУЩИХ КАНАЛОВ. У него есть ЯКОРЬ, которого не было ни у
 * MAX, ни у WhatsApp: диалог назван прямо в адресе. Значит probe может не
 * гадать, где лежит идентификатор чата, а искать в разметке ИЗВЕСТНОЕ ЧИСЛО и
 * показать все места, где ВК его держит. Отсюда главный отчёт ниже — `якорь`.
 *
 * ЧТО ДАЛ ПЕРВЫЙ ПРОГОН (01.09.2026) — и что он опроверг. Заочно мы ждали
 * старый интерфейс `vk.com/im?sel=<id>`. Живой адрес оказался другим:
 *
 *   vk.ru/gim137130907/convo/335368817?entrypoint=list_all
 *
 * То есть открывается НОВЫЙ VK Messenger, встроенный в страницу сообщества
 * (классы `ConvoHistory__flow`, `ConvoMessage`, `vkmListHeader`, разметка
 * VKUI), домен `vk.ru`, а диалог назван СЕГМЕНТОМ ПУТИ после `convo`, без
 * всякого `sel`. Разбор адреса здесь и на сервере исправлен по этому факту;
 * форма `sel` оставлена — старый интерфейс никуда не делся.
 *
 * Ещё два наблюдения того прогона, которые эта версия probe и должна довести
 * до фактов: лента ВИРТУАЛИЗИРУЕТСЯ (`VirtualScrollItem` с заглушками
 * `height: 100px` — всё, что выше экрана, в разметке пусто, поэтому смотреть
 * надо ХВОСТ ленты), а у элементов ленты есть `data-itemkey` с ПОСЛЕДОВАТЕЛЬНЫМИ
 * номерами (22, 23, 24…). Похоже на `conversation_message_id` — настоящий
 * идентификатор сообщения внутри диалога; если это он, ключ дедупа будет
 * НАСТОЯЩИЙ, а не синтетический, как в MAX. Проверяется прокруткой: у индекса
 * виртуального списка номера при подгрузке старых сообщений сдвигаются, у
 * идентификатора — нет.
 *
 * ЧТО УЖЕ СДЕЛАНО НА СЕРВЕРЕ (и что probe обязан подтвердить или опровергнуть):
 *   • собеседник берётся из сегмента после «convo» либо из «sel», а НЕ из пути
 *     целиком. Прежний разбор превращал «vk.com/gim216789012?sel=45678901» в
 *     «gim216789012» — id СООБЩЕСТВА, один на все диалоги; переписка всех
 *     родителей центра уехала бы в карточку первого привязанного клиента. Мина
 *     обезврежена (lib/ext/chat-identity.ts, normalizeVkChatId);
 *   • «id12345» и «12345» приводятся к одному ключу — чтобы ссылка из карточки
 *     клиента совпала с идентификатором открытого диалога;
 *   • беседа («c45», peer ≥ 2 000 000 000) и сообщество («-216789012») к
 *     клиенту не привязываются: за таким чатом стоит не один человек.
 *
 * ГЛАВНЫЕ ВОПРОСЫ ВТОРОГО ПРОГОНА — по убыванию цены ошибки:
 *   1. МЕНЯЕТСЯ ЛИ АДРЕС при переключении диалога. Первый прогон дал форму, но
 *      не ответил, переписывает ли её ВК на лету: если нет, опрос адреса
 *      бесполезен и чат придётся опознавать по разметке. Проверяется просто —
 *      открыть другой диалог и посмотреть на адресную строку.
 *   2. ЧТО ТАКОЕ ЧИСЛО В «/convo/<N>» — id пользователя или внутренний номер
 *      диалога. Отвечает секция `ссылкиНаПрофили`: если на странице есть ссылка
 *      `vk.ru/id<то же число>`, это peer id, и поле «ВКонтакте» в карточке
 *      клиента заработает как автоподсказка. Если нет — привязка ручная.
 *   3. ЕСТЬ ЛИ У СООБЩЕНИЯ СВОЙ ИДЕНТИФИКАТОР (кандидат — `data-itemkey`). В MAX
 *      его не оказалось, и ключ дедупа пришлось синтезировать из текста и
 *      времени, с двумя принятыми дефектами: правка сообщения даёт дубль, два
 *      одинаковых сообщения в одну минуту схлопываются. Настоящий id снимает оба.
 *   4. ЕСТЬ ЛИ МАШИННОЕ ВРЕМЯ. Дату разделители дают полную и с годом
 *      (`aria-label="25 апреля 2025"`) — это лучше, чем в MAX. Осталось время
 *      самого сообщения.
 *   5. ЧЕМ ОТЛИЧАЕТСЯ ИСХОДЯЩЕЕ от входящего. В сообщениях сообщества это
 *      особый случай: «наша» сторона — сообщество, а не человек, и подпись у
 *      исходящего может быть именем администратора.
 *
 * БЕЗОПАСНОСТЬ (те же правила, что в max-probe и wa-probe):
 *   • скрипт ТОЛЬКО ЧИТАЕТ видимый DOM. Не трогает localStorage, IndexedDB и
 *     cookie: там лежит сессия, а её утечка — это доступ ко всей переписке;
 *   • не трогает внутренние объекты страницы (window.vk, cur, Messages и
 *     прочее) — это путь скрейперов, за который блокируют аккаунты. Нам нужно
 *     только то, что и так на экране;
 *   • НИЧЕГО НЕ ОТПРАВЛЯЕТ. Проверка вставки (`tryInsert`) кладёт текст в поле
 *     ввода и останавливается; Enter не синтезируется никогда. Текст перед
 *     отправкой видно на экране — сотрите его вручную.
 *
 * КАК ЗАПУСКАТЬ.
 *   1. Открыть сообщения СООБЩЕСТВА (vk.com/gim<id> — «Сообщения» в управлении
 *      сообществом) и выбрать диалог с родителем, где есть переписка В ОБЕ
 *      СТОРОНЫ и хотя бы за два разных дня.
 *   2. F12 → Console → напечатать «allow pasting» → вставить весь файл → Enter.
 *   3. Отчёт ляжет в буфер обмена. Если нет: copy(JSON.stringify(crmkaVkProbe.last, null, 2))
 *   4. ПОВТОРИТЬ, не перезагружая страницу, в других местах — формы там разные,
 *      и адаптер обязан их различать:
 *        • ДРУГОЙ диалог того же сообщества (главная проверка: адрес и ключ
 *          обязаны отличаться от первого прогона);
 *        • личные сообщения сотрудника (vk.com/im);
 *        • БЕСЕДА, если есть (ожидаем «sel=c<N>»);
 *        • список диалогов, не открыв ни одного (что видит адаптер в этот момент).
 *      Каждый раз: crmkaVkProbe.rerun() и снова скопировать отчёт.
 *
 * ДОПОЛНИТЕЛЬНО (по одной команде за раз):
 *   crmkaVkProbe.rerun()             — пересобрать отчёт (после смены диалога)
 *   crmkaVkProbe.anchor()            — где в разметке лежит id диалога из адреса
 *   crmkaVkProbe.peerLinks()         — есть ли на странице ссылка vk.ru/id<то же число>
 *   crmkaVkProbe.headers()           — заголовок открытого диалога
 *   crmkaVkProbe.tail()              — ХВОСТ ленты вглубь (лента виртуализируется!)
 *   crmkaVkProbe.messages()          — инвентарь строк ленты целиком
 *   crmkaVkProbe.composerDeep()      — из чего сделано поле ввода
 *   await crmkaVkProbe.tryInsert("exec")  — вставка как в Telegram
 *   await crmkaVkProbe.tryInsert("paste") — вставка как в MAX (Lexical/React)
 *   await crmkaVkProbe.scrollCheck() — виртуализируется ли лента
 *   crmkaVkProbe.watch()             — что появляется в DOM при новом сообщении
 *   crmkaVkProbe.stop()              — выключить наблюдатель
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
   * Классы ВК исторически ОСМЫСЛЕННЫЕ («im-mess», «_im_peer», «im-page--dialog»),
   * в отличие от хешей Svelte в MAX и atomic-CSS Meta в WhatsApp. Но новый
   * VK Messenger собран иначе, и там могут быть хеши — отделяем одно от другого
   * сразу: цепляться в адаптере можно только за осмысленные.
   */
  const isNoiseClass = (c) => /^(?:[a-z]+[-_]?[A-Za-z0-9]{5,}|_[a-z0-9]{5,})$/.test(c) && !/[-_](?:im|mess|dialog|peer|chat|msg)/i.test(c)
  const classParts = (el) => [...el.classList].filter((c) => !isNoiseClass(c))

  const describe = (el) =>
    el
      ? {
          tag: el.tagName.toLowerCase(),
          classes: [...el.classList],
          attrs: attrs(el),
          text: cut(el.textContent),
        }
      : null

  /**
   * Компактное дерево узла: нужно, чтобы понять, ГДЕ внутри строки лежат текст,
   * время, статус доставки, вложения и реакции — всё это придётся вычищать при
   * сборе текста, иначе в карточку клиента уедет «текст сообщения16:04».
   */
  const tree = (el, depth = 0, max = TREE_DEPTH) => {
    if (!el || depth > max) return null
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join(" ")
    return {
      tag: el.tagName.toLowerCase(),
      classes: classParts(el),
      attrs: Object.fromEntries(Object.entries(attrs(el)).filter(([k]) => k !== "class")),
      ownText: cut(ownText) || undefined,
      children: [...el.children].slice(0, 10).map((child) => tree(child, depth + 1, max)),
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  1. Адрес: единственное место, где собеседник назван прямо
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Разбор адреса ЗЕРКАЛИТ серверный normalizeVkChatId — сознательно, чтобы
   * отчёт показывал не «что мы видим», а «что из этого получит сервер». Если
   * живой адрес окажется другой формы, расхождение будет видно сразу здесь, а не
   * через месяц в чужой переписке в карточке клиента.
   */
  function readLocation() {
    const { pathname, search, hash } = location
    const params = new URLSearchParams(`${search.replace(/^\?/, "")}&${hash.replace(/^#/, "")}`)
    const segments = pathname.split("/").filter((p) => p.trim())
    const segment = segments[0] ?? ""

    // Новый VK Messenger: «…/convo/<собеседник>» — форма подтверждена живым
    // прогоном 01.09.2026. «sel» остался у старого интерфейса, читаем вторым.
    const convoAt = segments.findIndex((p) => p.toLowerCase() === "convo")
    const sel =
      convoAt >= 0
        ? (segments[convoAt + 1] ?? "").trim()
        : (params.get("sel") ?? params.get("peer") ?? "").trim()
    const источникId = convoAt >= 0 ? "путь /convo/<id>" : sel ? "параметр sel" : "нет"

    let вид = "не разобрано"
    let ключ = null
    if (sel) {
      if (/^c\d+$/i.test(sel)) {
        вид = "беседа"
        ключ = sel.toLowerCase()
      } else if (/^\d+$/.test(sel) && Number(sel) >= 2_000_000_000) {
        вид = "беседа (peer_id)"
        ключ = `c${Number(sel) - 2_000_000_000}`
      } else if (/^-\d+$/.test(sel)) {
        вид = "сообщество"
        ключ = sel
      } else if (/^(?:id)?\d+$/i.test(sel)) {
        вид = "человек"
        ключ = sel.replace(/^id/i, "")
      } else {
        вид = "короткое имя"
        ключ = sel.toLowerCase()
      }
    } else if (/^(?:im|gim\d+|mail)$/i.test(segment)) {
      вид = "мессенджер открыт, диалог не выбран"
    } else if (segment) {
      вид = "страница вне мессенджера"
    }

    return {
      адрес: location.href,
      путь: pathname,
      search,
      hash,
      сегментПути: segment,
      сегменты: segments,
      сообществоВПути: /^gim(\d+)$/i.exec(segment)?.[1] ?? null,
      источникId,
      sel,
      интерфейс: location.hostname.includes("vk.me")
        ? "VK Messenger (web.vk.me)"
        : /^gim\d+$/i.test(segment)
          ? "сообщения сообщества (vk.com/gim…)"
          : /^im$/i.test(segment)
            ? "личные сообщения (vk.com/im)"
            : "прочее",
      вид,
      ключЧата: ключ,
      подсказка:
        "Разбор здесь тот же, что на сервере (normalizeVkChatId). «ключЧата» — то, под чем переписка ляжет в CRM.",
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  2. Якорь: ищем id собеседника из адреса во ВСЕЙ разметке
  // ───────────────────────────────────────────────────────────────────────────

  const SKIP_ATTRS = new Set(["class", "style", "src", "href", "d", "viewBox", "points", "transform", "srcset"])

  /**
   * ГЛАВНЫЙ ОТЧЁТ ПРОГОНА. Берём число из «sel» и ищем его во всех атрибутах и
   * во всех id элементов. Так видно, где ВК держит идентификатор собеседника —
   * и, значит, можно ли опознать чат, если адрес при переключении не меняется.
   *
   * Ищем ВХОЖДЕНИЕМ, а не равенством: у ВК идентификаторы обычно составные
   * («im_peer_45678901», «im-mess-stack--45678901»), и точное сравнение их бы
   * не заметило.
   */
  function anchor() {
    const { sel } = readLocation()
    const digits = (sel || "").replace(/^id/i, "")
    if (!digits) {
      return { найден: false, причина: "в адресе нет идентификатора диалога — откройте диалог и повторите" }
    }

    /** @type {Map<string, {атрибут: string, узлов: number, примеры: Set<string>, теги: Set<string>, классы: Set<string>}>} */
    const byAttr = new Map()
    for (const el of document.querySelectorAll("*")) {
      for (const a of el.attributes) {
        if (SKIP_ATTRS.has(a.name)) continue
        const value = String(a.value)
        if (!value.includes(digits)) continue
        const bucket =
          byAttr.get(a.name) ??
          byAttr
            .set(a.name, { атрибут: a.name, узлов: 0, примеры: new Set(), теги: new Set(), классы: new Set() })
            .get(a.name)
        bucket.узлов++
        bucket.теги.add(el.tagName.toLowerCase())
        if (bucket.примеры.size < 6) bucket.примеры.add(cut(value))
        for (const c of classParts(el)) if (bucket.классы.size < 8) bucket.классы.add(c)
      }
    }

    return {
      искали: digits,
      найден: byAttr.size > 0,
      подсказка:
        "Здесь видно, где ВК держит идентификатор собеседника. Если пусто — чат опознаётся только по адресу, и адаптер обязан следить за ним.",
      поАтрибутам: [...byAttr.values()].map((b) => ({
        атрибут: b.атрибут,
        узлов: b.узлов,
        теги: [...b.теги],
        классы: [...b.классы],
        примеры: [...b.примеры],
      })),
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  3. Лента сообщений
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Кандидаты в строки сообщений. Не полагаемся на то, что «мы знаем селектор»:
   * сперва пробуем известные (старый vk.com/im), а если ни один не подошёл —
   * ищем структурно, по повторяющимся узлам с текстом.
   */
  // Порядок важен: первым идёт то, что подтверждено живым прогоном 01.09.2026
  // (новый VK Messenger), дальше — старый vk.com/im, и только в конце широкие
  // «по вхождению». Первый прогон как раз и споткнулся о широкий селектор: он
  // поймал не сообщения, а выпадашки действий (`ConvoMessage__actions`), и весь
  // инвентарь строк оказался пустым.
  const MESSAGE_SELECTORS = [
    // Прогон 01.09.2026: строка ленты — это <article class="ConvoHistory__messageBlock">.
    // `VirtualScrollItem` для этого НЕ ГОДИТСЯ, хотя и выглядит подходящим: тем
    // же классом помечены строки СПИСКА ДИАЛОГОВ слева, и общий предок находок
    // уезжал на весь экран приложения — контейнером ленты оказывался `MEApp__route`.
    "article.ConvoHistory__messageBlock",
    "[class~='ConvoHistory__messageBlock']",
    ".ConvoMessage:not([class*='__'])",
    "[class~='ConvoMessage']",
    "[data-msgid]",
    "[data-message-id]",
    "[data-id^='im-mess']",
    ".im-mess",
    ".im-mess-stack",
    "._im_mess",
    "[class*='MessageBubble']",
  ]

  function messageNodes() {
    for (const selector of MESSAGE_SELECTORS) {
      let nodes = []
      try {
        nodes = [...document.querySelectorAll(selector)]
      } catch {
        continue
      }
      const visible = nodes.filter((n) => n.getClientRects().length > 0)
      if (visible.length >= 2) return { selector, nodes: visible }
    }
    return { selector: null, nodes: [] }
  }

  /**
   * Всё, похожее на идентификатор, у самой строки, у её ДВУХ ПРЕДКОВ и у первых
   * потомков.
   *
   * Предки здесь несущие, а не «на всякий случай»: живой прогон показал
   * `data-itemkey` именно на обёртке `VirtualScrollItem`, а сообщение лежит
   * внутри неё. Ключ помечаем источником — «своё» / «предок-1» / «потомок», —
   * иначе по отчёту не понять, за что адаптеру цепляться.
   *
   * @param {Element} el
   */
  function idAttributes(el) {
    const result = {}
    const take = (node, label) => {
      if (!node) return
      for (const a of node.attributes ?? []) {
        if (SKIP_ATTRS.has(a.name)) continue
        if (!/id|key|msg|cmid/i.test(a.name)) continue
        result[`${label}:${a.name}`] = cut(a.value)
      }
    }
    take(el, "своё")
    take(el.parentElement, "предок-1")
    take(el.parentElement?.parentElement, "предок-2")
    for (const child of [...el.children].slice(0, 3)) take(child, "потомок")
    return result
  }

  /**
   * Класс, который правда говорит о направлении, а не просто содержит эти буквы.
   *
   * Прогон 01.09.2026 поймал нас на этом: у ВК половина классов —
   * `…--withoutBubbles`, и наивная проверка «содержит out» объявляла признаком
   * направления слово «withOUT». В отчёте это выглядело как найденный признак,
   * которого на самом деле нет, — худший вид ложного факта: по нему пишется
   * правило адаптера. Поэтому «out/own/self/my» ищем как ОТДЕЛЬНОЕ слово, по
   * границам дефиса, подчёркивания или заглавной буквы.
   *
   * @param {string} c
   */
  const isDirectionClass = (c) =>
    // Реакции исключаем ЯВНО: у «сердечка» класс `ReactionChip--incoming`, где
    // «incoming» — про того, кто реакцию поставил, а не про автора сообщения.
    // Наше исходящее с реакцией родителя выглядело бы входящим, то есть
    // реплика администратора уехала бы в карточку как слова клиента.
    !/Reaction/i.test(c) &&
    (/(?:^|[-_])(?:out|own|self|my|in|incoming|outgoing)(?:[-_]|$)/i.test(c) ||
      /(?:Out|Own|Self|My|Incoming|Outgoing)(?:[A-Z]|$)/.test(c))

  /**
   * Кто написал строку — имя и ссылка автора, если ВК их показывает.
   *
   * В сообщениях сообщества это ключ к направлению: у исходящих автором
   * значится САМО СООБЩЕСТВО (а в скобках — имя администратора, который писал),
   * у входящих — человек. Классов направления в разметке, похоже, нет вовсе,
   * так что правило придётся строить на этом.
   *
   * @param {Element} el
   */
  function author(el) {
    const link = el.querySelector("a[href^='/']")
    const nameNode = el.querySelector("[class*='author'], [class*='Author'], [class*='Title']")
    return {
      имя: nameNode ? cut(nameNode.textContent) : null,
      ссылка: link?.getAttribute("href") ?? null,
      // Первые слова строки: у ВК автор часто просто первым текстом в блоке.
      началоТекста: cut(el.textContent).slice(0, 60),
    }
  }

  /**
   * Инвентарь строк ленты: атрибуты, классы, текст, всё похожее на время и на
   * идентификатор. По нему пишутся правила адаптера — читать эту секцию надо
   * целиком, а не по первому попавшемуся образцу.
   */
  function messages() {
    const { selector, nodes } = messageNodes()
    if (nodes.length === 0) {
      return {
        найдено: 0,
        подсказка:
          "Ни один известный селектор не подошёл. Пришлите дерево: crmkaVkProbe.last.лентаДерево — по нему напишем селекторы.",
      }
    }

    const tail = nodes.slice(-SAMPLE)
    return {
      селектор: selector,
      найдено: nodes.length,
      подсказка:
        "Смотрим: есть ли СВОЙ id у строки (иначе ключ дедупа придётся синтезировать, как в MAX), есть ли машинное время, чем отличается исходящее.",
      строки: tail.map((el) => ({
        ...describe(el),
        // Идентификатор строки — главный вопрос прогона. Ищем НЕ ТОЛЬКО на самом
        // узле: у ВК `data-itemkey` живёт на обёртке виртуального списка
        // (`VirtualScrollItem`), то есть на РОДИТЕЛЕ сообщения, и проверка
        // только своих атрибутов возвращала пустоту — кандидат в ключ дедупа
        // не доезжал до отчёта вовсе.
        идентификаторы: idAttributes(el),
        // Всё, что похоже на время: машинное (unix, ISO, title) и видимое.
        время: {
          атрибутыСоВременем: Object.fromEntries(
            [...el.querySelectorAll("*")]
              .flatMap((n) => [...n.attributes].map((a) => [a.name, a.value, n]))
              .filter(([name, value]) => /time|date|title|datetime/i.test(name) && String(value).trim())
              .slice(0, 6)
              .map(([name, value]) => [name, cut(value)]),
          ),
          видимое: cut(
            [...el.querySelectorAll("[class*='time'], [class*='Time'], time")]
              .map((n) => n.textContent)
              .join(" | "),
          ),
        },
        // Направление. В сообщениях сообщества «нашей» стороной выступает
        // сообщество, а не человек, поэтому смотрим и классы, и АВТОРА строки.
        признакиНаправления: {
          классыСOut: [...el.classList].filter(isDirectionClass),
          вложенныеСOut: [
            ...new Set(
              [...el.querySelectorAll("*")].flatMap((n) => [...n.classList]).filter(isDirectionClass),
            ),
          ].slice(0, 6),
          aria: el.getAttribute("aria-label") ? cut(el.getAttribute("aria-label")) : null,
          автор: author(el),
        },
        // Глубина явная: обход начинается с нуля и идёт на шесть уровней. Раньше
        // сюда передавалась «3» — но это НАЧАЛЬНАЯ глубина, а не предельная, и
        // дерево обрывалось через два уровня, ровно над текстом и временем. Та
        // же ошибка была в хвосте ленты; лечится в обоих местах одинаково.
        дерево: tree(el, 0, 6),
      })),
    }
  }

  /**
   * ХВОСТ ЛЕНТЫ целиком — последние узлы, развёрнутые вглубь.
   *
   * Первый прогон показал, зачем это нужно: лента виртуализируется
   * (`VirtualScrollItem` с заглушками `height: 100px`), и всё, что выше экрана,
   * в разметке ПУСТО. Дерево от начала ленты состоит из одних заглушек и не
   * говорит о сообщении ничего. Смотреть надо снизу — там, где человек и видит
   * переписку.
   */
  function tail(count = 3) {
    const container = feedContainer()
    if (!container) return { найдено: 0, подсказка: "лента не найдена" }
    const children = [...container.children]
    return {
      подсказка:
        "Последние узлы ленты, развёрнутые вглубь: здесь видно, как устроено ОТРИСОВАННОЕ сообщение — где текст, где время, где признак направления.",
      контейнер: describe(container),
      всегоУзловЛенты: children.length,
      // Глубина больше обычной: сообщение лежит на 4–5 уровнях от узла ленты, и
      // на стандартной глубине хвост обрывался ровно над текстом — ради чего
      // всю секцию и делали.
      хвост: children.slice(-count).map((el) => tree(el, 0, 8)),
    }
  }

  /**
   * Контейнер ленты. Общий предок сообщений не годится сам по себе: у ВК
   * сообщения одного дня лежат в своём блоке (`ConvoHistory__dateStack`), и
   * предок двух соседних строк — этот блок, а не лента. Поэтому поднимаемся до
   * узла, который лентой себя и объявляет (`role="list"`), а не догадываемся.
   */
  function feedContainer() {
    const { nodes } = messageNodes()
    const ancestor = commonAncestor(nodes)
    const list = ancestor?.closest("[role='list'], .ConvoHistory__flow")
    return list ?? ancestor ?? document.querySelector("[role='list'], .ConvoHistory__flow")
  }

  /**
   * ССЫЛКИ НА ПРОФИЛИ на странице — ответ на главный открытый вопрос прогона:
   * ЧЕМ является число в адресе `/convo/<N>` — идентификатором пользователя или
   * внутренним номером диалога.
   *
   * Если среди ссылок найдётся `vk.ru/id<N>` с тем же числом, что в адресе, —
   * это peer id, и тогда поле «ВКонтакте» в карточке клиента начнёт работать
   * само: администратор вписал ссылку на страницу родителя, панель узнала диалог
   * без ручной привязки. Если совпадения нет — номер внутренний, и привязка
   * остаётся ручной (как в MAX).
   */
  function peerLinks() {
    const { sel } = readLocation()
    const digits = (sel || "").replace(/^id/i, "")
    const links = [...document.querySelectorAll("a[href]")]
      .map((a) => ({ href: a.getAttribute("href") ?? "", text: cut(a.textContent) }))
      .filter((l) => /(?:^|\/)(?:id\d+|club\d+|public\d+|[a-z][a-z0-9_.]{2,})(?:$|[?#/])/i.test(l.href))
      .filter((l) => !/\.(?:png|jpg|jpeg|svg|webp)/i.test(l.href))
      .slice(0, 40)

    // Ссылка из шапки открытого диалога — страница СОБЕСЕДНИКА. Прогон
    // 01.09.2026 показал, что там стоит короткое имя («/umnyiidd»), а не
    // «/id<N>»: у кого имя задано, ВК показывает его. Отсюда практический вывод —
    // адаптер обязан слать это имя ВТОРЫМ идентификатором чата (altIds), иначе
    // поле «ВКонтакте» в карточке клиента, куда администратор вписывает ссылку
    // на страницу, никогда не совпадёт с числовым ключом диалога.
    const headerLink = document
      .querySelector(".ConvoHeader__info, [class*='ConvoHeader'] a[href^='/']")
      ?.getAttribute("href")
    const screenName = headerLink?.replace(/^\//, "").split(/[?#/]/)[0] ?? null

    return {
      подсказка:
        "Ищем, чем ВК называет собеседника. Число из адреса — ключ диалога; короткое имя из шапки — второй идентификатор, по нему сойдётся ссылка из карточки клиента.",
      идИзАдреса: digits || null,
      совпадениеСПрофилем: digits
        ? links.some((l) => new RegExp(`(?:^|/)id${digits}(?:$|[?#/])`).test(l.href))
        : false,
      короткоеИмяСобеседника: screenName,
      ссылкаИзШапки: headerLink ?? null,
      ссылки: links,
    }
  }

  /**
   * Шапка открытого диалога: имя собеседника и всё, что рядом.
   *
   * Первый прогон поймал не её, а заголовок СПИСКА диалогов (название
   * сообщества), поэтому берём шире и показываем несколько кандидатов — пусть
   * решает глаз, а не наш селектор.
   */
  function headers() {
    const candidates = [
      ".ConvoHeader",
      "[class*='ConvoHeader']",
      "[class*='PeerTitle']",
      "[class*='im-page--title']",
      "[class*='Header__title']",
      ".vkmListHeader__title",
    ]
    const found = []
    for (const selector of candidates) {
      for (const el of document.querySelectorAll(selector)) {
        if (el.getClientRects().length === 0) continue
        found.push({ селектор: selector, ...describe(el) })
        if (found.length >= 6) break
      }
    }
    return {
      подсказка:
        "Заголовок диалога — ЛОКАЛЬНЫЙ ключ («тот же диалог или уже другой»), на сервер не уходит никогда: два клиента с одинаковой подписью схлопнулись бы в одну карточку.",
      кандидаты: found,
    }
  }

  /**
   * Общий предок видимых строк — кандидат в контейнер ленты. Тот же приём, что
   * в адаптере MAX: родитель не годится (капсула с датой пузырю не родня).
   */
  function commonAncestor(nodes) {
    if (nodes.length === 0) return null
    let node = nodes[0]
    while (node && !nodes.every((n) => node.contains(n))) node = node.parentElement
    return node
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  4. Поле ввода
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Поле ввода ищем ШИРОКО: contenteditable в любом написании плюс textarea.
   * Урок MAX: Lexical ставит contenteditable="" (ПУСТОЕ значение), и селектор
   * [contenteditable="true"] его не находит вовсе.
   */
  function composers() {
    const nodes = [
      ...document.querySelectorAll("[contenteditable], textarea, [role='textbox']"),
    ].filter((n) => n.getClientRects().length > 0)
    return nodes.map((el) => ({
      ...describe(el),
      contenteditable: el.getAttribute("contenteditable"),
      видимыйРазмер: `${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`,
      редактор:
        el.getAttribute("data-lexical-editor") === "true"
          ? "Lexical (как в MAX — вставка синтетическим paste)"
          : el.tagName.toLowerCase() === "textarea"
            ? "textarea (правится значением + событие input)"
            : "contenteditable (возможно, execCommand как в Telegram)",
    }))
  }

  function composerDeep() {
    const list = composers()
    if (list.length === 0) return { найдено: 0 }
    const main = document.querySelector("[contenteditable]:not([contenteditable='false'])") ?? document.querySelector("textarea")
    return {
      найдено: list.length,
      кандидаты: list,
      главный: main ? { ...describe(main), дерево: tree(main, 3), предки: ancestry(main) } : null,
    }
  }

  /** Цепочка предков с классами — по ней ищется устойчивый селектор. */
  const ancestry = (el) => {
    const chain = []
    let node = el?.parentElement
    while (node && chain.length < 6) {
      chain.push({ tag: node.tagName.toLowerCase(), classes: classParts(node), id: node.id || undefined })
      node = node.parentElement
    }
    return chain
  }

  /**
   * Проверка вставки. ТОЛЬКО кладёт текст в поле — Enter не синтезируется.
   *
   * Два способа, ровно как в предыдущих каналах: execCommand работает в Telegram,
   * но теряет переносы строк в Lexical (MAX); синтетический paste работает в
   * Lexical. Какой нужен ВК — вопрос этой проверки, а не догадки.
   *
   * @param {"exec"|"paste"} mode
   */
  async function tryInsert(mode = "exec") {
    const field =
      document.querySelector("[contenteditable]:not([contenteditable='false'])") ??
      document.querySelector("textarea")
    if (!field) return { ok: false, причина: "поле ввода не найдено" }

    const sample = "CRMka probe\nвторая строка"
    const before = field.value ?? field.innerText ?? ""
    field.focus()

    if (field.tagName.toLowerCase() === "textarea") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
      setter?.call(field, sample)
      field.dispatchEvent(new Event("input", { bubbles: true }))
    } else if (mode === "paste") {
      const dt = new DataTransfer()
      dt.setData("text/plain", sample)
      field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }))
    } else {
      document.execCommand("insertText", false, sample)
    }

    // Реконсиляция React/Lexical происходит на микротаске — синхронная проверка
    // соврала бы (ровно эта ловушка ловила нас в MAX).
    await new Promise((r) => setTimeout(r, 120))
    const after = field.value ?? field.innerText ?? ""

    return {
      способ: mode,
      былоДо: cut(before),
      сталоПосле: cut(after),
      вставилось: after.includes("CRMka probe"),
      переносСохранён: /CRMka probe\s*\n\s*вторая строка/.test(after),
      важно:
        "Текст остался в поле — сотрите его вручную. Кнопка отправки могла стать активной; probe ничего не отправляет.",
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  5. Прокрутка и наблюдатель
  // ───────────────────────────────────────────────────────────────────────────

  /** Виртуализируется ли лента: если да, «последние 10» надо брать осторожнее. */
  async function scrollCheck() {
    const { nodes } = messageNodes()
    const container = commonAncestor(nodes)
    if (!container) return { ok: false, причина: "лента не найдена" }
    const scroller =
      [container, ...ancestryNodes(container)].find(
        (n) => n.scrollHeight > n.clientHeight + 40 && getComputedStyle(n).overflowY !== "visible",
      ) ?? null
    if (!scroller) return { ok: false, причина: "прокручиваемый контейнер не найден" }

    const before = messageNodes().nodes.length
    const top = scroller.scrollTop
    scroller.scrollTop = 0
    await new Promise((r) => setTimeout(r, 900))
    const after = messageNodes().nodes.length
    scroller.scrollTop = top

    return {
      строкДо: before,
      строкПослеПрокруткиВверх: after,
      подгружает: after > before,
      виртуализируется: after < before,
      подсказка: "«виртуализируется: true» значит старые строки выбрасываются из DOM — для нас не страшно, мы берём хвост.",
    }
  }

  /**
   * КОМПАКТНЫЙ СРЕЗ НАПРАВЛЕНИЙ — по строке на сообщение, без деревьев.
   *
   * Нужен, чтобы проверить признак стороны на ЧУЖОМ сообщении: во всех прогонах
   * до сих пор попадались только исходящие, и правило «отрицательный peer id в
   * маске аватара = сообщество» проверено лишь на своих.
   *
   * Логика вывода продублирована из common/vk-message.js (decideDirection)
   * сознательно: probe обязан работать вставкой в консоль, без импортов. Источник
   * истины — там; здесь эти же правила, чтобы в отчёте было видно не только
   * сырьё, но и то, что из него получится.
   */
  function directions() {
    const { nodes } = messageNodes()
    return {
      подсказка:
        "Проверяем признак стороны. «поПризнакам» — что решит адаптер; сверьте с тем, что видите на экране: у сообщения РОДИТЕЛЯ должно быть «incoming».",
      строки: nodes.slice(-12).map((el) => {
        const avatar = el.querySelector("[clip-path], [style*='clip-path']")
        const raw =
          avatar?.getAttribute("clip-path") ?? avatar?.getAttribute("style") ?? ""
        const peerId = /Mask(-?\d+)/.exec(raw)?.[1] ?? null
        const hasReadStatus = Boolean(
          el.querySelector("[class*='statusIcon'], [aria-label='Прочитано'], [aria-label='Отправлено']"),
        )
        return {
          itemKey: el.parentElement?.getAttribute("data-itemkey") ?? null,
          текст: cut(el.querySelector("[class*='MessageText']")?.textContent ?? el.textContent).slice(0, 70),
          часы: cut(el.querySelector("[class*='__date']")?.textContent ?? ""),
          peerIdАвтора: peerId,
          галочкиПрочтения: hasReadStatus,
          поПризнакам: peerId
            ? peerId.startsWith("-")
              ? "outgoing"
              : "incoming"
            : hasReadStatus
              ? "outgoing"
              : "наследуется от строки выше",
        }
      }),
    }
  }

  /**
   * ГЛАВНАЯ ОСТАВШАЯСЯ ПРОВЕРКА: `data-itemkey` — идентификатор сообщения или
   * позиция в виртуальном списке?
   *
   * От ответа зависит ключ дедупа: настоящий идентификатор снимает оба принятых
   * в MAX дефекта (правка сообщения даёт дубль, два одинаковых сообщения в
   * минуту схлопываются), а позиция — наоборот, после подгрузки истории съедет,
   * и та же переписка ляжет в карточку ВТОРОЙ раз, необратимо.
   *
   * Проверка делает всё сама: снимает номера, прокручивает ленту вверх (чтобы
   * ВК догрузил историю), возвращается вниз и сравнивает номера У ТЕХ ЖЕ
   * сообщений — сопоставляя их ПО ТЕКСТУ, а не по позиции.
   *
   * Возврат вниз обязателен: лента виртуализируется, и без него нижние строки
   * просто исчезли бы из разметки — сравнивать стало бы нечего.
   */
  async function keyCheck() {
    const snapshot = () =>
      messageNodes().nodes.map((el) => ({
        itemKey: el.parentElement?.getAttribute("data-itemkey") ?? null,
        текст: cut(el.querySelector("[class*='MessageText']")?.textContent ?? el.textContent).slice(0, 70),
      }))

    const before = snapshot()
    if (before.length === 0) return { ok: false, причина: "сообщения не найдены — откройте диалог" }

    const container = feedContainer()
    const scroller =
      [container, ...ancestryNodes(container)].find(
        (n) => n && n.scrollHeight > n.clientHeight + 40 && getComputedStyle(n).overflowY !== "visible",
      ) ?? null
    if (!scroller) return { ok: false, причина: "прокручиваемый контейнер не найден" }

    const bottom = scroller.scrollTop
    scroller.scrollTop = 0
    await new Promise((r) => setTimeout(r, 1500))
    const строкВверху = messageNodes().nodes.length
    scroller.scrollTop = scroller.scrollHeight
    await new Promise((r) => setTimeout(r, 1200))
    scroller.scrollTop = bottom
    await new Promise((r) => setTimeout(r, 300))

    const after = snapshot()
    const пары = []
    for (const item of before) {
      if (!item.текст) continue
      const match = after.find((x) => x.текст === item.текст)
      if (!match) continue
      пары.push({ текст: item.текст, было: item.itemKey, стало: match.itemKey })
    }

    const сдвинулись = пары.filter((p) => p.было !== p.стало)
    return {
      строкДоПрокрутки: before.length,
      строкВверхуЛенты: строкВверху,
      строкПослеВозврата: after.length,
      сопоставленоПоТексту: пары.length,
      сдвинулосьНомеров: сдвинулись.length,
      вердикт:
        пары.length === 0
          ? "сравнивать нечего — история не подгрузилась или лента выбросила строки; повторите в диалоге с длинной перепиской"
          : сдвинулись.length === 0
            ? "НОМЕРА НЕ СДВИНУЛИСЬ — похоже на настоящий идентификатор сообщения"
            : "НОМЕРА СДВИНУЛИСЬ — это позиция в списке, ключ дедупа останется синтетическим",
      примеры: пары.slice(0, 8),
      разошлись: сдвинулись.slice(0, 8),
    }
  }

  const ancestryNodes = (el) => {
    const chain = []
    let node = el?.parentElement
    while (node && chain.length < 8) {
      chain.push(node)
      node = node.parentElement
    }
    return chain
  }

  /** @type {MutationObserver|null} */
  let observer = null

  /**
   * Что появляется в DOM при новом сообщении. Нужно для сигнала активности:
   * своего события у мессенджеров нет, панель обновляется по наблюдателю.
   */
  function watch() {
    stop()
    const { nodes } = messageNodes()
    const container = commonAncestor(nodes) ?? document.body
    observer = new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node.nodeType !== 1) continue
          console.log("[crmka probe] новый узел:", {
            ...describe(/** @type {Element} */ (node)),
            дерево: tree(/** @type {Element} */ (node), 2),
          })
        }
      }
    })
    observer.observe(container, { childList: true, subtree: true })
    return "Наблюдатель включён. Попросите написать вам в этот диалог — узел появится в консоли. Выключить: crmkaVkProbe.stop()"
  }

  function stop() {
    observer?.disconnect()
    observer = null
    return "Наблюдатель выключен"
  }

  // ───────────────────────────────────────────────────────────────────────────
  //  Отчёт
  // ───────────────────────────────────────────────────────────────────────────

  function build() {
    const container = feedContainer()

    return {
      снято: new Date().toISOString(),
      адрес: readLocation(),
      якорь: anchor(),
      ссылкиНаПрофили: peerLinks(),
      заголовокЧата: headers(),
      сообщения: messages(),
      лентаКонтейнер: describe(container),
      // Хвост, а не начало: лента виртуализируется, и всё выше экрана — пустые
      // заглушки. Первый прогон уткнулся ровно в это.
      хвостЛенты: tail(),
      полеВвода: composers(),
      страница: {
        хост: location.hostname,
        язык: document.documentElement.lang || null,
        всегоУзлов: document.querySelectorAll("*").length,
        // Сколько на странице осмысленных опор: если мало, нужен удалённый
        // конфиг селекторов, как для MAX.
        узловСDataАтрибутами: document.querySelectorAll("[data-msgid], [data-id], [data-peer], [data-testid]").length,
      },
    }
  }

  function rerun() {
    const report = build()
    api.last = report
    try {
      copy(JSON.stringify(report, null, 2))
      console.log("[crmka probe] отчёт собран и скопирован в буфер обмена")
    } catch {
      console.log("[crmka probe] отчёт собран. Скопировать: copy(JSON.stringify(crmkaVkProbe.last, null, 2))")
    }
    return report
  }

  const api = {
    last: null,
    rerun,
    anchor,
    peerLinks,
    headers,
    messages,
    directions,
    keyCheck,
    tail,
    composerDeep,
    tryInsert,
    scrollCheck,
    watch,
    stop,
  }

  globalThis.crmkaVkProbe = api
  rerun()
  // Версию печатаем сознательно: probe вставляют в консоль руками, и «какая
  // сборка сейчас загружена» иначе никак не проверить — а по старой сборке
  // легко собрать отчёт, отвечающий на уже закрытые вопросы.
  console.log(
    "[crmka probe] ВКонтакте v4. Все команды — через объект (в консоли сама по себе rerun() не видна).\n" +
      "  Что нужно сейчас, двумя командами:\n" +
      "    copy(crmkaVkProbe.directions())        — кто автор каждой строки (нужен ВХОДЯЩИЙ)\n" +
      "    copy(await crmkaVkProbe.keyCheck())    — сам прокрутит ленту и скажет, id это или позиция\n" +
      "  Остальное: .rerun() · .anchor() · .peerLinks() · .headers() · .messages() · .tail() · .composerDeep()\n" +
      '            await .tryInsert("exec"|"paste") · await .scrollCheck() · .watch() / .stop()',
  )
})()
