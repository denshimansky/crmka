/**
 * Адаптер ВКонтакте — content script, isolated world.
 *
 * ВСЁ ЗДЕСЬ ПО ЖИВОЙ РАЗМЕТКЕ, снятой четырьмя прогонами probe 01.09.2026
 * (docs/messenger-extension.md §8, Фаза 6). Заочные предположения о ВК —
 * «vk.com/im?sel=<id>», старая разметка `im-mess` — живая страница опровергла:
 * у сообщества открывается НОВЫЙ VK Messenger на VKUI, домен vk.ru, а диалог
 * назван сегментом пути после `convo`.
 *
 * Что важно знать про этот канал:
 *   • АДРЕС МЕНЯЕТСЯ при переключении диалога («…/gim<сообщество>/convo/<peer>»),
 *     и в нём лежит peer id ПОЛЬЗОВАТЕЛЯ — подтверждено совпадением со ссылкой
 *     `/id<N>` в шапке. Значит поле «ВКонтакте» в карточке клиента работает как
 *     автоподсказка. Навигация внутренняя, `popstate` на неё не срабатывает —
 *     смену чата ловим опросом пути, как в MAX;
 *   • ПУТЬ ЦЕЛИКОМ ИДЕНТИФИКАТОРОМ НЕ ЯВЛЯЕТСЯ: первый сегмент — это САМО
 *     СООБЩЕСТВО, одно на все диалоги. Приняв его за ключ, мы сложили бы
 *     переписку всех родителей центра в одну карточку. Разбор — common/vk-peer.js;
 *   • КЛАССОВ НАПРАВЛЕНИЯ НЕТ ВОВСЕ. Сторона видна по peer id в маске аватара
 *     (у сообщества он отрицательный), по галочкам статуса (их ВК рисует только
 *     у своих) и наследованием в серии подряд идущих — common/vk-message.js;
 *   • ИДЕНТИФИКАТОРА СООБЩЕНИЯ НЕТ. `data-itemkey` на обёртке виртуального
 *     списка похож на позицию, а не на id, поэтому ключ дедупа синтезируется —
 *     как в MAX, с теми же двумя принятыми дефектами;
 *   • ВРЕМЯ собирается из двух половин: часы в строке, дата — в разделителе дня
 *     выше по ленте. Дата полная, с годом, машиночитаемая (`aria-label`);
 *   • БЕСЕДЫ И ДИАЛОГИ С СООБЩЕСТВАМИ панель не ведёт: за таким чатом стоит не
 *     один человек, и его переписку нельзя положить в карточку одного клиента.
 *
 * Безопасность (§7 спеки, соблюдать буквально):
 *   • MAIN-world не используем, внутренние объекты страницы не трогаем;
 *   • localStorage/cookie ВК не читаем — там сессия;
 *   • Enter не синтезируем никогда: отправляет человек.
 */

// Ни одного объявления на ВЕРХНЕМ уровне: все content scripts расширения делят
// глобальное лексическое окружение изолированного мира (см. adapter-core.js).
;(() => {
  const core = /** @type {any} */ (globalThis).__crmkaAdapterCore
  if (!core) return

  const COLLECT_LIMIT = core.COLLECT_LIMIT
  const readCleanText = core.readCleanText

  /** @typedef {import("../common/types.js").ChatContext} ChatContext */
  /** @typedef {import("../common/types.js").ChatMessage} ChatMessage */

  /**
   * ВСТРОЕННЫЕ СЕЛЕКТОРЫ — всё, что адаптер знает о разметке ВК, и одновременно
   * набор ключей, которые можно переопределить удалённым конфигом
   * (`GET /api/ext/selectors`). Классы у VKUI осмысленные и не хешируются, но
   * переименовать их могут в любой сборке, а починка зашитого в код селектора
   * означает публикацию в стор — то есть дни ревью с мёртвым каналом.
   */
  const DEFAULTS = {
    /** Лента сообщений: `role="list"` она объявляет сама. */
    feed: '.ConvoHistory__flow, [role="list"][aria-label]',
    /** Строка ленты. */
    row: "article.ConvoHistory__messageBlock, [class*='ConvoHistory__messageBlock']",
    /** Разделитель дня — единственный источник ДАТЫ. */
    separator: "[class*='DateSeparator']",
    /** Текст сообщения. Часы лежат отдельно, поэтому склейки «текст16:04» нет. */
    text: "[class*='MessageText']",
    /** Часы сообщения. Рядом может стоять подпись администратора: «17:18 (Анна И)». */
    clock: "[class*='ConvoMessageInfoWithoutBubbles__date'], [class*='__date']",
    /** Галочки доставки: ВК рисует их ТОЛЬКО у своих сообщений. */
    status: "[class*='statusIcon']",
    /** Аватар автора — в его маске лежит peer id автора. */
    avatar: "[class*='__avatar'] [class*='MEAvatar'] [style*='clip-path'], [class*='__avatar'] use[clip-path]",
    /** Ссылка-аватар в ленте: ведёт на страницу автора сообщения. */
    avatarLink: "a[class*='__avatar']",
    /** Шапка диалога и чистое имя собеседника внутри неё. */
    header: "[class*='ConvoHeader']",
    headerTitle: "[class*='PeerTitle']",
    /** Ссылка на страницу собеседника — второй идентификатор чата. */
    headerLink: "[class*='ConvoHeader__info'], [class*='ConvoHeader'] a[href^='/']",
    /** Поле ввода — обычный contenteditable, не Lexical. */
    composerField: "[class*='ComposerInput__input'][contenteditable], [contenteditable][role='textbox']",
    /**
     * Что вычищаем из строки перед чтением текста.
     *
     * Реакции здесь несущие: у «сердечка» класс `ReactionChip--incoming`, где
     * «incoming» про того, кто реакцию поставил. Подробности — в vk-message.js.
     */
    junk: [
      "[class*='__reactions']",
      "[class*='ReactionChip']",
      "[class*='ConvoMessage__actions']",
      "[class*='MessageActionsDropdown']",
      "[class*='selectToggler']",
      "[class*='navigationSelectToggler']",
      "[class*='__date']",
      "[class*='statusIcon']",
    ],
  }

  /** Действующие селекторы: встроенные плюс переопределения из конфига. */
  let SEL = { ...DEFAULTS }

  /** Как часто сверяем адрес: навигация внутренняя, события у неё нет. */
  const PATH_POLL_MS = 400

  /**
   * Сколько ждём после смены адреса, прежде чем собирать сообщения.
   *
   * Причина та же, что в MAX и WhatsApp: разметка прошлого диалога живёт в DOM
   * ещё какое-то время, а ключ сообщения склеивается с chatId ТЕКУЩЕГО чата —
   * чужая переписка осела бы в чужой карточке навсегда. Пропущенная заливка
   * догоняется следующим сигналом активности и кнопкой ⟳; ошибка — нет.
   */
  const SETTLE_MS = 700

  /** Сколько ждём, пока поле ввода примет вставленный текст. */
  const INSERT_TIMEOUT_MS = 400

  // Content script в MV3 — классический скрипт, статический import невозможен.
  /** @type {typeof import("../common/vk-peer.js") | null} */
  let vkPeer = null
  /** @type {typeof import("../common/vk-message.js") | null} */
  let vkMessage = null
  /** @type {typeof import("../common/selector-config.js") | null} */
  let selectorConfig = null

  /** Что сейчас с конфигом селекторов — строкой, для диагностики в ping. */
  let configState = "встроенные селекторы"

  /**
   * Разбирается ли строка как CSS-селектор. Главная защита от опечатки в
   * удалённом конфиге: невалидный селектор бросает прямо в `querySelectorAll`, и
   * механизм починки канала стал бы способом сломать его сильнее.
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
   * Применить кэш удалённого конфига поверх встроенных селекторов. Считаем от
   * DEFAULTS каждый раз: конфиг может и УБРАТЬ переопределение, а накопление
   * правок поверх правок дало бы залипшее значение.
   * @param {any} cached
   */
  function applySelectorConfig(cached) {
    if (!selectorConfig) return
    const overrides = selectorConfig.readChannelOverrides(cached, "vk")
    const merged = selectorConfig.mergeSelectors(DEFAULTS, overrides, isValidSelector)
    SEL = merged.selectors
    if (!merged.applied.length && !merged.rejected.length) {
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

  /** Адрес, который видели в прошлый раз, и момент, когда он сменился. */
  let lastPath = location.pathname
  let pathChangedAt = Date.now()

  /**
   * Итоги последнего сбора — в ответ на ping. Не украшение: пропуск строк по
   * устройству молчалив, и без счётчиков сломанный разбор выглядит как «просто
   * ничего не заливается».
   */
  let lastCollect = { всего: 0, взято: 0, безНаправления: 0, безВремени: 0, пустых: 0 }

  /** Запомнить смену адреса: с неё начинается окно «кадра перехода». */
  function notePath() {
    if (location.pathname === lastPath) return
    lastPath = location.pathname
    pathChangedAt = Date.now()
  }

  /** Успела ли разметка догнать адрес (см. SETTLE_MS). */
  function settled() {
    return Date.now() - pathChangedAt >= SETTLE_MS
  }

  /**
   * Имя собеседника — подсказка человеку при ручной привязке.
   *
   * Берём `.PeerTitle` ВНУТРИ шапки: в самой шапке к имени приклеен статус
   * («Ольга Подфедькозаходила 12 минут назад»), а в списке диалогов те же
   * `.PeerTitle` есть у каждой строки — без сужения поймали бы чужое имя.
   * @returns {string|null}
   */
  function readChatTitle() {
    const header = document.querySelector(SEL.header)
    const title = header?.querySelector(SEL.headerTitle)?.textContent?.trim()
    if (title) return title
    const fallback = header?.textContent?.trim()
    return fallback || null
  }

  /**
   * Второй идентификатор чата — из ссылки на страницу собеседника в шапке.
   *
   * Зачем он, если ключ уже есть в адресе: у кого задано короткое имя, ВК
   * показывает в ссылке именно его («/umnyiidd»), а НЕ «/id<N>». Администратор
   * вписывает в карточку клиента ссылку на страницу — то есть то же короткое
   * имя. Без этого алиаса числовой ключ диалога с ним никогда бы не сошёлся, и
   * автоподсказка не работала бы у всех, у кого есть короткое имя.
   *
   * Канон из мешка идентификаторов выбирает сервер (chat-canonical.ts): для ВК
   * это числовой peer id, потому что короткое имя владелец страницы может
   * сменить когда захочет.
   * @returns {string|null}
   */
  function readPeerHandle(chatId) {
    const fromHeader = handleFromHref(
      document.querySelector(SEL.headerLink)?.getAttribute("href"),
    )
    if (fromHeader) return fromHeader

    // Запасной путь: аватар собеседника в самой ленте. Ссылка в шапке есть не
    // везде (в личных сообщениях профиль открывается панелью справа, а не
    // ссылкой), и без этого пути автоподсказка не работала бы ровно там, где
    // администратор ведёт переписку с личного аккаунта.
    //
    // БЕРЁМ СТРОГО АВАТАР, ЧЕЙ PEER ID РАВЕН КЛЮЧУ ЧАТА. Это не перестраховка:
    // в личном чате в ленте висит и НАШ аватар со ссылкой на наш профиль, и
    // взяв его, мы бы отдали серверу собственный handle как второй
    // идентификатор чата — а он одинаков во ВСЕХ диалогах. Все переписки
    // склеились бы в одну карточку, необратимо.
    if (!chatId) return null
    for (const node of document.querySelectorAll(SEL.avatarLink)) {
      const link = /** @type {HTMLElement} */ (node)
      if (readAuthorPeerId(link) !== chatId) continue
      const handle = handleFromHref(link.getAttribute("href"))
      if (handle) return handle
    }
    return null
  }

  /** «/annmalafeeva?w=wall1_1» → «annmalafeeva»; сообщество — не собеседник. */
  function handleFromHref(href) {
    if (!href) return null
    const handle = href.replace(/^\//, "").split(/[?#/]/)[0]?.trim()
    if (!handle) return null
    if (/^(?:club|public|event)\d+$/i.test(handle)) return null
    return handle
  }

  /** Лента сообщений. @returns {HTMLElement|null} */
  function messagesRoot() {
    return /** @type {HTMLElement|null} */ (document.querySelector(SEL.feed))
  }

  /**
   * Peer id автора строки — из маски аватара.
   *
   * ВК подставляет его в id обрезки: `mePeerFrameOffline36Mask-137130907`.
   * Ищем и в `clip-path`, и в `style`: у одного узла он атрибутом, у другого —
   * инлайновым стилем.
   *
   * @param {HTMLElement} row
   * @returns {string|null}
   */
  function readAuthorPeerId(row) {
    for (const node of row.querySelectorAll("[clip-path], [style*='clip-path'], clipPath[id]")) {
      const raw =
        node.getAttribute("clip-path") ??
        node.getAttribute("style") ??
        node.getAttribute("id") ??
        ""
      const peerId = vkMessage?.parseAuthorPeerId(raw)
      if (peerId) return peerId
    }
    return null
  }

  /**
   * Направление строки.
   *
   * Гард на null обязателен: правило «нет признака — значит входящее» при
   * переименовании класса молча превратило бы ВСЮ исходящую переписку во
   * входящую, а это ложь в карточке клиента, которую потом не отличить от
   * правды.
   *
   * @param {HTMLElement} row
   * @param {"incoming"|"outgoing"|null} previous Направление строки выше.
   * @param {string|null} chatPeerId Ключ чата — peer id собеседника.
   * @returns {"incoming"|"outgoing"|null}
   */
  function readDirection(row, previous, chatPeerId) {
    if (!vkMessage) return null
    return vkMessage.decideDirection({
      authorPeerId: readAuthorPeerId(row),
      // Ключ чата и есть собеседник: чей id с ним совпал — тот и написал, всё
      // остальное наше. Знак для этого не годится — в личных сообщениях наша
      // сторона такая же положительная, как родитель (см. decideDirection).
      chatPeerId,
      // Статус доставки ищем строго в пределах строки: он бывает только у своих.
      hasReadStatus: Boolean(row.querySelector(SEL.status)),
      previousDirection: previous,
    })
  }

  /**
   * Подпись разделителя дня. Предпочитаем `aria-label`: там полная дата с годом
   * машиночитаемо, а видимый текст может быть сокращён.
   * @param {Element} node
   */
  function readSeparatorText(node) {
    const labelled = node.matches("[aria-label]") ? node : node.querySelector("[aria-label]")
    return labelled?.getAttribute("aria-label")?.trim() || node.textContent?.trim() || ""
  }

  /**
   * Видимые сообщения открытого чата.
   *
   * Идём СВЕРХУ ВНИЗ: дата лежит в разделителе ВЫШЕ сообщения, а направление у
   * серии подряд идущих наследуется от строки выше — оба разбора однопроходные
   * только в этом порядке.
   *
   * @returns {ChatMessage[]}
   */
  function collectVisibleMessages() {
    lastCollect = { всего: 0, взято: 0, безНаправления: 0, безВремени: 0, пустых: 0 }
    if (!vkPeer || !vkMessage) return []

    const chat = readChat()
    // Беседы и диалоги с сообществами не собираем — первый из четырёх рубежей
    // (дальше service worker, панель, сервер). Ни один убирать нельзя: старая
    // сборка расширения в браузере сотрудника переживает любой по отдельности.
    if (!chat || chat.unsupported) return []
    if (!settled()) return []

    const root = messagesRoot()
    if (!root) return []

    const now = new Date()
    /** Подпись последнего разделителя, который РАЗОБРАЛСЯ в дату. */
    let separator = null
    /** @type {"incoming"|"outgoing"|null} */
    let previousDirection = null
    /** @type {ChatMessage[]} */
    const out = []

    for (const node of root.querySelectorAll(`${SEL.row}, ${SEL.separator}`)) {
      const el = /** @type {HTMLElement} */ (node)

      if (el.matches(SEL.separator)) {
        // Разделитель внутри строки — это что-то другое.
        if (el.closest(SEL.row)) continue
        const text = readSeparatorText(el)
        // Запоминаем ТОЛЬКО разобравшуюся дату: в ленте бывают и другие
        // разделители («Непрочитанные»), и затирать ими дату нельзя — иначе
        // следующие сообщения остались бы без времени и не залились.
        if (vkMessage.parseSeparatorDate(text, now)) separator = text
        continue
      }

      // Вложенная строка (цитата, пересылка) отдельным сообщением не считается.
      if (el.parentElement?.closest(SEL.row)) continue
      lastCollect.всего++

      const direction = readDirection(el, previousDirection, chat.chatId)
      if (!direction) {
        lastCollect.безНаправления++
        continue
      }
      previousDirection = direction

      const textNode = el.querySelector(SEL.text) ?? el
      const text = readCleanText(textNode, SEL.junk)
      if (!text) {
        // Штатно: стикеры, фото и голосовые без подписи текста не имеют.
        lastCollect.пустых++
        continue
      }

      const sentAt = vkMessage.buildMessageSentAt({
        separator,
        clock: el.querySelector(SEL.clock)?.textContent ?? null,
        now,
      })
      const externalId = vkMessage.buildVkMessageId({
        chatId: chat.chatId,
        direction,
        sentAt,
        text,
      })
      if (!externalId) {
        // Без разобранного времени ключ недетерминирован, и карточка получала бы
        // копию переписки при каждом открытии чата. Потеря обратима, дубль — нет.
        lastCollect.безВремени++
        continue
      }

      out.push({ externalId, direction, text, sentAt })
    }

    // Только хвост: в ленте лежит вся подгруженная история, а заливать её
    // целиком нельзя — лента коммуникаций утонет в старой переписке.
    const tail = out.slice(-COLLECT_LIMIT)
    lastCollect.взято = tail.length
    return tail
  }

  /**
   * Отпечаток самого свежего сообщения: по нему ядро понимает, что пришло новое,
   * и будит панель.
   *
   * Количество строк в ключ НЕ берём: лента ВК виртуализируется, и счётчик
   * менялся бы на каждой прокрутке — панель бегала бы в CRM без повода.
   * @returns {string|null}
   */
  function readLatestMessageKey() {
    if (!vkMessage) return null
    const root = messagesRoot()
    if (!root) return null
    const rows = root.querySelectorAll(SEL.row)
    const last = /** @type {HTMLElement|undefined} */ (rows[rows.length - 1])
    if (!last) return null
    return vkMessage.buildVkActivityKey({
      direction: readDirection(last, null, readChat()?.chatId ?? null) ?? "incoming",
      clock: last.querySelector(SEL.clock)?.textContent ?? null,
      text: readCleanText(last.querySelector(SEL.text) ?? last, SEL.junk),
    })
  }

  /** Поле ввода. @returns {HTMLElement|null} */
  function findComposer() {
    for (const node of document.querySelectorAll(SEL.composerField)) {
      const el = /** @type {HTMLElement} */ (node)
      if (!el.isContentEditable) continue
      if (el.offsetParent || el.getClientRects().length > 0) return el
    }
    return null
  }

  /** Каретка в конец поля — вставляем в конец черновика, не затирая набранное. */
  function placeCaretAtEnd(el) {
    const selection = window.getSelection()
    if (!selection) return
    // Если человек уже стоит курсором внутри поля, его позицию не трогаем.
    if (selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      return
    }
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /** Видимый текст поля в сравнимом виде — сравниваем факт изменения, не вёрстку. */
  function visibleText(el) {
    return (el.innerText ?? "").replace(/\s+/g, " ").trim()
  }

  /**
   * Вставить текст в поле ввода — НЕ отправляя.
   *
   * `execCommand`, как в Telegram, а НЕ синтетический paste, как в MAX. Это не
   * догадка: проверено на живом ВК 01.09.2026 — вставка проходит и ПЕРЕНОСЫ
   * СТРОК СОХРАНЯЮТСЯ (справка и ИИ-черновик у нас многострочные, и в MAX
   * `execCommand` их как раз терял, из-за чего там пришлось перейти на paste).
   *
   * @param {string} text
   * @returns {Promise<boolean>} удалось ли вставить. Ответ асинхронный: поле
   *   реагирует на вставку не мгновенно, и синхронная проверка соврала бы.
   */
  async function insertIntoComposer(text) {
    const el = findComposer()
    if (!el || !text) return false
    el.focus()
    placeCaretAtEnd(el)
    await new Promise((resolve) => setTimeout(resolve, 30))

    const before = visibleText(el)
    document.execCommand("insertText", false, text)

    const deadline = Date.now() + INSERT_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      if (visibleText(el) !== before) return true
    }
    // Судим по факту, а не по возвращённому значению execCommand: панель по
    // этому ответу решает, класть ли текст в буфер обмена.
    return false
  }

  /**
   * Открытый чат как контекст для панели.
   *
   * Беседу и диалог с сообществом отдаём ВМЕСТЕ с признаком `unsupported`, а не
   * прячем: панель должна объяснить человеку, почему карточки нет именно здесь.
   * Молчание он прочитал бы как поломку.
   *
   * @returns {ChatContext|null}
   */
  function readChat() {
    if (!vkPeer) return null
    notePath()
    const place = vkPeer.parseVkLocation(location)
    if (place.kind !== "chat" && place.kind !== "multi") return null
    const chatId = place.chatId
    if (!chatId) return null

    // Мешок идентификаторов: числовой ключ из адреса плюс короткое имя со
    // страницы собеседника. Канон выбирает сервер — для ВК числовой, потому что
    // короткое имя владелец страницы может сменить.
    const handle = place.kind === "chat" ? readPeerHandle(chatId) : null
    const altIds = [chatId]
    if (handle && !altIds.includes(handle)) altIds.push(handle)

    return {
      channel: "vk",
      chatId,
      altIds,
      peerSource: place.kind === "multi" ? "беседа или сообщество" : "адрес /convo/",
      title: readChatTitle(),
      // Телефона у ВК нет вовсе; сервер его от этого канала и не примет
      // (acceptsPhoneParam), но врать не будем и здесь.
      phone: null,
      unsupported: place.kind === "multi" ? "group" : null,
    }
  }

  // Старт: сначала чистые модули (они покрыты тестами), потом описание канала
  // ядру. Разбор адреса обязателен — без него мы не знаем, какой чат открыт.
  Promise.all([
    import(chrome.runtime.getURL("src/common/vk-peer.js")),
    import(chrome.runtime.getURL("src/common/vk-message.js")).catch(() => null),
    import(chrome.runtime.getURL("src/common/selector-config.js")).catch(() => null),
  ])
    .then(([peer, message, config]) => {
      vkPeer = peer
      vkMessage = message
      selectorConfig = config

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
        channel: "vk",
        ready: () => Boolean(vkPeer),
        readChat,
        collectMessages: collectVisibleMessages,
        latestMessageKey: readLatestMessageKey,
        insertText: insertIntoComposer,
        // Смену чата ловим ОПРОСОМ адреса: навигация внутренняя, `popstate` на
        // неё не срабатывает. popstate слушаем дополнительно — он ловит «назад».
        watch: (onChange) => {
          const check = () => {
            if (location.pathname === lastPath) return
            notePath()
            onChange()
          }
          const timer = setInterval(check, PATH_POLL_MS)
          window.addEventListener("popstate", check)
          return () => {
            clearInterval(timer)
            window.removeEventListener("popstate", check)
          }
        },
        diag: () => ({
          path: location.pathname,
          kind: vkPeer ? vkPeer.parseVkLocation(location).kind : null,
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
