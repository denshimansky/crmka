/**
 * Адаптер MAX (web.max.ru) — content script, isolated world.
 *
 * Что важно знать про MAX (docs/messenger-extension.md §2 и §8, Фаза 4):
 *   • это SvelteKit, ХЭША НЕТ ВОВСЕ: чат живёт в пути («web.max.ru/437719203»),
 *     навигация идёт через pushState, и `popstate` на неё не срабатывает —
 *     смену чата ловим опросом `location.pathname`;
 *   • ИДЕНТИФИКАТОРА СООБЩЕНИЯ В РАЗМЕТКЕ НЕТ (проверено пятью прогонами probe:
 *     у узла только `role` и `class`), поэтому ключ дедупа синтезируется —
 *     common/max-message.js;
 *   • МАШИННОГО ВРЕМЕНИ ТОЖЕ НЕТ: часы лежат строкой в `.meta` внутри пузыря, а
 *     дата — в капсуле-разделителе ВЫШЕ группы сообщений. Собираем из двух
 *     половин — common/max-time.js;
 *   • ГРУППОВЫЕ ЧАТЫ (отрицательный id) панель НЕ ОБСЛУЖИВАЕТ. Это решение
 *     спеки, а не упрощение: привязка группы к клиенту не рабочий сценарий, а
 *     цена ошибки необратима — вся групповая переписка чужих родителей уедет в
 *     карточку одного человека;
 *   • ТЕЛЕФОНА НЕТ: он закрыт настройкой приватности PHONE_NUMBER_PRIVACY, а
 *     @username у людей в MAX не бывает вовсе. Клиента ищет человек, связь
 *     запоминается привязкой.
 *
 * Безопасность (§7 спеки, соблюдать буквально):
 *   • MAIN-world НЕ ИСПОЛЬЗУЕМ. CSP на web.max.ru — Report-Only с `report-uri`,
 *     то есть инъекция скрипта в страницу сама отправит отчёт на серверы MAX;
 *   • `__oneme_auth` в localStorage НЕ ТРОГАЕМ КАТЕГОРИЧЕСКИ — это токен сессии;
 *   • НИКОГДА не синтезируем `keydown` Enter: именно этот обработчик в MAX
 *     отправляет сообщение, а Lexical не проверяет `isTrusted`. Отправляет
 *     человек — это принцип-щит §3, а не деталь реализации.
 */

// Ни одного объявления на ВЕРХНЕМ уровне: все content scripts расширения делят
// глобальное лексическое окружение изолированного мира, и одинаковые имена в
// двух адаптерах дали бы SyntaxError на инстанциации — до первой исполняемой
// строки, то есть до любого рантайм-гарда (подробности в adapter-core.js).
;(() => {
  const core = /** @type {any} */ (globalThis).__crmkaAdapterCore
  // Ядро объявлено первым файлом этой же записи content_scripts. Нет его —
  // значит манифест собран неправильно; молча выходим, страницу не ломаем.
  if (!core) return

  const COLLECT_LIMIT = core.COLLECT_LIMIT
  const readCleanText = core.readCleanText

  /** @typedef {import("../common/types.js").ChatContext} ChatContext */
  /** @typedef {import("../common/types.js").ChatMessage} ChatMessage */

  /**
   * ВСТРОЕННЫЕ СЕЛЕКТОРЫ. Классы Svelte хешируются на каждой сборке
   * («messageWrapper svelte-1kh0oxy»), поэтому цепляемся ТОЛЬКО за авторскую
   * часть класса через `[class*="…"]` либо за `data-testid`/`data-*`.
   *
   * Всё, что вообще знает адаптер о разметке MAX, лежит здесь — и это же набор
   * ключей, которые можно переопределить удалённым конфигом (Шаг 4, §3 спеки:
   * авторскую часть класса тоже могут переименовать, и тогда канал чинится
   * правкой на сервере, а не публикацией в стор с многодневным ревью).
   * Значения из конфига проходят проверку типа и разбора — common/selector-config.js.
   */
  const DEFAULTS = {
    /** Пузырь сообщения. */
    bubble: '[class*="messageWrapper"]',
    /** Капсула-разделитель с датой («Сегодня», «2 июля 2026»). */
    capsule: '[class*="capsule"], [class*="dateLabel"], [class*="separator"]',
    /** Направление: атрибут внутри пузыря. Надёжнее модификатора класса. */
    variant: "[data-bubbles-variant]",
    /** Часы и галочки доставки. Лежат ВНУТРИ блока текста. */
    meta: '[class*="meta"]',
    /**
     * Блок текста внутри пузыря. `:not(…messageWrapper…)` обязателен: «Wrapper»
     * тоже содержит «message», и без исключения селектор ловил бы сам пузырь.
     */
    text: '[class*="message"]:not([class*="messageWrapper"])',
    /** Поле ввода — Lexical, редактор Meta. */
    composerRoot: '[data-testid="composer"]',
    /**
     * Само редактируемое поле. `[contenteditable]` без значения — не небрежность:
     * MAX пишет `contenteditable=""` (пустое = true по спецификации), и селектор
     * `[contenteditable="true"]` его НЕ находит.
     */
    composerField: '[data-lexical-editor="true"], [contenteditable]',
    /** Шапка чата: имя собеседника — подсказка человеку при ручной привязке. */
    title: [
      '[data-testid="chat-header"] [class*="title"]',
      '[class*="chatHeader"] [class*="title"]',
      '[class*="headerTitle"]',
      'header [class*="title"]',
    ],
    /**
     * Что вычищаем из пузыря перед чтением текста.
     *
     * `meta` обязателен: часы лежат ВНУТРИ блока текста, и наивный textContent
     * склеивал бы их с сообщением («дальше16:15») — ровно та ошибка, которую мы
     * уже ловили в Telegram. Остальное — предположения по аналогии с Telegram:
     * если таких узлов в MAX нет, вычистка безвредна, а если есть — это ровно
     * то, что в переписку клиента попадать не должно.
     */
    junk: [
      '[class*="meta"]',
      '[class*="reaction"]',
      '[class*="reply"]',
      '[class*="quote"]',
      '[class*="forward"]',
    ],
  }

  /** Действующие селекторы: встроенные плюс переопределения из конфига. */
  let SEL = { ...DEFAULTS }

  /** Как часто сверяем адрес: у MAX нет ни хэша, ни события навигации. */
  const PATH_POLL_MS = 400

  /**
   * Сколько ждём после смены адреса, прежде чем собирать сообщения.
   *
   * ЗАЧЕМ. Разметка прошлого диалога живёт в DOM ещё какое-то время после смены
   * адреса, а ключ сообщения склеивается с chatId ТЕКУЩЕГО чата — то есть чужая
   * переписка осела бы в чужой карточке навсегда (уникальный ключ дедупа не даёт
   * её переписать). В Telegram от этого спасает сужение до контейнера активного
   * диалога; в MAX опоры для такого сужения нет — id чата в разметке не
   * встречается вовсе.
   *
   * СКОЛЬКО ИМЕННО — вопрос к probe v5 (docs §8.1): сколько миллисекунд живут
   * пузыри прошлого чата. До ответа берём с запасом. Цена запаса невелика:
   * пропущенная заливка догоняется следующим же сигналом активности (новая
   * лента, отрисовавшись, меняет отпечаток последнего сообщения) и кнопкой ⟳.
   */
  const SETTLE_MS = 700

  /** Сколько ждём реконсиляцию Lexical после вставки (он работает на микротаске). */
  const INSERT_TIMEOUT_MS = 500

  // Content script в MV3 — классический скрипт, статический import невозможен.
  // Чистые модули (разбор адреса, времени, ключа) подтягиваем динамически: они
  // покрыты тестами и живут в web_accessible_resources.
  /** @type {typeof import("../common/max-path.js").parseMaxPath | null} */
  let parseMaxPath = null
  /** @type {typeof import("../common/max-time.js") | null} */
  let maxTime = null
  /** @type {typeof import("../common/max-message.js") | null} */
  let maxMessage = null
  /** @type {typeof import("../common/selector-config.js") | null} */
  let selectorConfig = null

  /** Что сейчас с конфигом селекторов — строкой, для диагностики в ping. */
  let configState = "встроенные селекторы"

  /**
   * Разбирается ли строка как CSS-селектор.
   *
   * Это главная защита от опечатки в удалённом конфиге: невалидный селектор
   * бросает SyntaxError прямо в `querySelectorAll`, и механизм починки канала
   * стал бы способом сломать его сильнее. Фрагмент документа берём вместо
   * `document`, чтобы ничего не искать по-настоящему.
   *
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
   *
   * Считаем от DEFAULTS каждый раз, а не от текущего SEL: конфиг может и УБРАТЬ
   * переопределение (аварию починили — вернули встроенное), и накопление правок
   * поверх правок дало бы залипшее значение.
   *
   * @param {any} cached Значение chrome.storage.local[SELECTOR_CONFIG_KEY].
   */
  function applySelectorConfig(cached) {
    if (!selectorConfig) return
    const overrides = selectorConfig.readChannelOverrides(cached, "max")
    const merged = selectorConfig.mergeSelectors(DEFAULTS, overrides, isValidSelector)
    SEL = merged.selectors
    if (!merged.applied.length && !merged.rejected.length) {
      // Различать «конфиг приехал и он пустой» и «конфиг не приезжал вовсе»
      // обязательно. Обе ситуации выглядят одинаково — работаем на встроенных, —
      // но в первой механизм починки канала жив, а во второй он мёртв, и узнать
      // об этом в аварии, когда чинить надо сейчас, поздно.
      configState = cached?.channels
        ? `встроенные селекторы (конфиг v${cached.version ?? "?"} пуст — это норма)`
        : "встроенные селекторы (конфиг не получен)"
      return
    }
    // Отклонённые ключи показываем ОБЯЗАТЕЛЬНО: конфиг правят в аварии, и
    // «применил, но не то» без этой строки выглядит как «не помогло».
    configState =
      `конфиг v${cached?.version ?? "?"}: ` +
      `применено [${merged.applied.join(", ") || "—"}]` +
      (merged.rejected.length ? `, ОТКЛОНЕНО [${merged.rejected.join(", ")}]` : "")
  }

  /** Адрес, который видели в прошлый раз, и момент, когда он сменился. */
  let lastPath = location.pathname
  let pathChangedAt = Date.now()

  /**
   * Итоги последнего сбора — в ответ на ping (диагностика в панели).
   *
   * Не украшение: пропуск пузырей здесь по устройству молчалив. Если MAX
   * переименует атрибут направления или сломается разбор капсул, расширение
   * просто перестанет что-то заливать — и узнали бы мы об этом через месяц по
   * пустой переписке в карточках. Со счётчиками это видно сразу.
   */
  let lastCollect = { всего: 0, взято: 0, служебных: 0, безНаправления: 0, безВремени: 0, пустых: 0 }

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
   * Имя собеседника из шапки — подсказка человеку при ручной привязке.
   *
   * Селекторы шапки живой проверкой НЕ подтверждены (probe снимал ленту и поле
   * ввода), поэтому есть запасной путь через `document.title`. Ошибка здесь
   * безобидна: имя нигде не участвует в сопоставлении, только показывается.
   * @returns {string|null}
   */
  function readChatTitle() {
    for (const selector of SEL.title) {
      const text = document.querySelector(selector)?.textContent?.trim()
      if (text) return text
    }
    // «(3) Мария — MAX» → «Мария»: счётчик непрочитанных и имя приложения.
    const raw = (document.title || "")
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\s*[—–|·-]\s*MAX\s*$/i, "")
      .trim()
    if (!raw || /^max$/i.test(raw)) return null
    return raw
  }

  /**
   * Контейнер ленты сообщений — ОБЩИЙ ПРЕДОК всех видимых пузырей.
   *
   * Почему не просто родитель пузырей, как напрашивается. Дата сообщения лежит в
   * капсуле-разделителе, а капсула пузырю НЕ родня: если MAX группирует день в
   * свой блок, капсула окажется рядом с блоком, а не внутри него. Взяв родителя
   * пузырей, мы бы получили ленту без единой капсулы — то есть без дат, а без
   * даты сообщение не заливается вовсе. Отказ был бы полным и молчаливым.
   *
   * Чем платим. В Telegram сужение до контейнера активного диалога защищает от
   * чужой переписки: тот клиент держит в DOM и другие открытые чаты. За MAX
   * такого не замечено (probe видел ровно столько пузырей, сколько в открытом
   * чате), а от разметки прошлого диалога сразу после переключения защищает окно
   * SETTLE_MS. Если живой прогон покажет, что MAX всё-таки держит соседние чаты,
   * здесь понадобится опора на активный диалог — и тогда это первый кандидат на
   * правку (см. extension/TESTING.md, пункт про быстрое переключение).
   *
   * @returns {HTMLElement|null} null — пузырей нет вовсе (пустой чат либо
   *   сломались селекторы). Ни в том, ни в другом случае собирать нечего.
   */
  function messagesRoot() {
    const all = [...document.querySelectorAll(SEL.bubble)]
    // Невидимые пузыри — почти наверняка остаток прошлого диалога либо скрытая
    // разметка; если видимых не осталось вовсе, берём что есть.
    const visible = all.filter(
      (node) =>
        /** @type {HTMLElement} */ (node).offsetParent !== null ||
        node.getClientRects().length > 0,
    )
    const bubbles = visible.length > 0 ? visible : all
    if (bubbles.length === 0) return null

    /** @type {HTMLElement|null} */
    let root = /** @type {HTMLElement|null} */ (bubbles[0].parentElement)
    for (const node of bubbles) {
      while (root && !root.contains(node)) {
        root = /** @type {HTMLElement|null} */ (root.parentElement)
      }
    }
    return root
  }

  /** @param {Element} node @returns {boolean} */
  function isCapsule(node) {
    return node.matches(SEL.capsule)
  }

  /**
   * Направление сообщения.
   *
   * Порядок важен. Сначала атрибут `data-bubbles-variant` — он есть у ОБЕИХ
   * сторон, поэтому его отсутствие сразу отличает поломку от входящего
   * сообщения. Модификатор класса `--isOut` (с заглавной O!) — запасной путь.
   *
   * ГАРД: не нашли ни того, ни другого — возвращаем null, и пузырь пропускается.
   * Правило «нет класса — значит входящее» при переименовании модификатора молча
   * превратило бы ВСЮ исходящую переписку во входящую, а это ложь в карточке
   * клиента, которую потом не отличить от правды.
   *
   * @param {HTMLElement} bubble
   * @returns {"incoming"|"outgoing"|null}
   */
  function readDirection(bubble) {
    // Атрибут стоит и внутри composer, поэтому ищем строго в пределах пузыря.
    const variant = bubble.querySelector(SEL.variant)?.getAttribute("data-bubbles-variant")
    if (variant === "outgoing" || variant === "incoming") return variant
    for (const cls of bubble.classList) {
      if (/--isout/i.test(cls)) return "outgoing"
    }
    return null
  }

  /**
   * Видимые сообщения открытого чата.
   *
   * Идём СВЕРХУ ВНИЗ, а не с конца, как в Telegram: дата сообщения лежит в
   * капсуле-разделителе ВЫШЕ него, и при обратном обходе её пришлось бы каждый
   * раз доискивать. Пузырей в ленте сотни, обход всё равно линейный.
   *
   * @returns {ChatMessage[]}
   */
  function collectVisibleMessages() {
    lastCollect = { всего: 0, взято: 0, служебных: 0, безНаправления: 0, безВремени: 0, пустых: 0 }
    if (!parseMaxPath || !maxTime || !maxMessage) return []

    const chat = readChat()
    // Групповые чаты не собираем — первый из четырёх рубежей (остальные: service
    // worker, панель, сервер). Ни один из них убирать нельзя: старая сборка
    // расширения в браузере сотрудника переживает любой из них по отдельности.
    if (!chat || chat.unsupported) return []
    // Кадр перехода: разметка ещё может принадлежать прошлому диалогу.
    if (!settled()) return []

    const root = messagesRoot()
    if (!root) return []

    const now = new Date()
    /** Текст последней капсулы, которая РАЗОБРАЛАСЬ в дату. */
    let capsule = null
    /** @type {ChatMessage[]} */
    const out = []

    for (const node of root.querySelectorAll(`${SEL.bubble}, ${SEL.capsule}`)) {
      const el = /** @type {HTMLElement} */ (node)
      if (isCapsule(el)) {
        // Капсула внутри пузыря — это что-то другое (например, обвязка времени).
        if (el.closest(SEL.bubble)) continue
        const text = readCleanText(el, [])
        // Запоминаем ТОЛЬКО разобравшуюся дату: в ленте бывают и другие
        // разделители («Непрочитанные»), и затирать ими дату нельзя — иначе
        // следующие сообщения остались бы без времени и не залились.
        if (maxTime.parseCapsuleDate(text, now)) capsule = text
        continue
      }

      // Вложенный пузырь (цитата, пересылка) отдельным сообщением не считаем.
      if (el.parentElement?.closest(SEL.bubble)) continue
      lastCollect.всего++

      const direction = readDirection(el)
      if (!direction) {
        lastCollect.безНаправления++
        continue
      }

      // Текст берём из внутреннего блока сообщения, если он есть: в самом
      // wrapper лежит ещё и обвязка.
      const textNode = el.querySelector(SEL.text) ?? el
      const text = readCleanText(textNode, SEL.junk)
      if (!text) {
        // Штатно: стикеры и фото без подписи после вычистки `.meta` пустеют.
        lastCollect.пустых++
        continue
      }
      if (maxMessage.isServiceLine(text)) {
        // Звонки MAX рисует в ленте обычным текстом — репликой родителя это не
        // является, и в карточке ему делать нечего.
        lastCollect.служебных++
        continue
      }

      const sentAt = maxTime.buildMessageSentAt({
        capsule,
        clock: el.querySelector(SEL.meta)?.textContent ?? null,
        now,
      })
      const externalId = maxMessage.buildMaxMessageId({
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
    // целиком в CRM нельзя — лента коммуникаций утонет в старой переписке.
    const tail = out.slice(-COLLECT_LIMIT)
    lastCollect.взято = tail.length
    return tail
  }

  /**
   * Отпечаток самого свежего сообщения: по нему ядро понимает, что пришло новое,
   * и будит панель.
   *
   * В Telegram для этого берётся максимальный id сообщения; в MAX id нет вовсе,
   * поэтому считаем отпечаток последнего пузыря. Количество пузырей в ключ НЕ
   * берём: виртуализируется ли лента MAX, мы пока не знаем (вопрос probe v5), а
   * при виртуализации счётчик менялся бы на каждой прокрутке и панель бегала бы
   * в CRM без повода.
   *
   * @returns {string|null}
   */
  function readLatestMessageKey() {
    if (!maxMessage) return null
    const root = messagesRoot()
    if (!root) return null
    const bubbles = root.querySelectorAll(SEL.bubble)
    const last = /** @type {HTMLElement|undefined} */ (bubbles[bubbles.length - 1])
    if (!last) return null
    return maxMessage.buildMaxActivityKey({
      direction: readDirection(last) ?? "incoming",
      clock: last.querySelector(SEL.meta)?.textContent ?? null,
      text: readCleanText(last.querySelector(SEL.text) ?? last, SEL.junk),
    })
  }

  /**
   * Поле ввода. В MAX это Lexical (редактор Meta), и он объявлен как
   * `contenteditable=""` — ПУСТОЕ значение атрибута. Селектор
   * `[contenteditable="true"]`, которым мы ищем поле в Telegram, его НЕ находит:
   * на этом промахнулся первый probe.
   * @returns {HTMLElement|null}
   */
  function findComposer() {
    const scopes = [document.querySelector(SEL.composerRoot), document]
    for (const scope of scopes) {
      if (!scope) continue
      for (const node of scope.querySelectorAll(SEL.composerField)) {
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

  /**
   * Видимый текст поля в сравнимом виде.
   *
   * У ПУСТОГО редактора Lexical `innerText` равен «\n», а не пустой строке (он
   * рисует пустой абзац) — на этом уже споткнулся probe, отчитавшись «вставилось
   * трока один». Схлопываем пробелы: сравниваем факт изменения, а не вёрстку.
   * @param {HTMLElement} el
   */
  function visibleText(el) {
    return (el.innerText ?? "").replace(/\s+/g, " ").trim()
  }

  /**
   * Вставить текст в поле ввода — НЕ отправляя.
   *
   * СИНТЕТИЧЕСКИЙ `paste`, А НЕ `execCommand` — и это осознанное расхождение с
   * адаптером Telegram. Проверено на живом MAX 31.08.2026: оба способа редактор
   * принимает, но `execCommand` ТЕРЯЕТ ПЕРЕНОСЫ СТРОК («строка одинстрока два»).
   * Причина в устройстве Lexical: `execCommand` не порождает `beforeinput`,
   * поэтому `insertLineBreak` приходит с `data === null`, перенос не
   * регистрируется, а вставленный браузером `<br>` сносит собственный
   * MutationObserver редактора. Справка и ИИ-черновик у нас многострочные.
   *
   * Запасного пути через `execCommand` здесь нарочно НЕТ: наполовину вставленный
   * текст в поле, откуда человек отправляет сообщение родителю, хуже, чем
   * честный отказ — на отказ панель кладёт текст в буфер обмена.
   *
   * @param {string} text
   * @returns {Promise<boolean>} удалось ли вставить. Ответ асинхронный: Lexical
   *   реконсилирует DOM на микротаске, и синхронная проверка соврала бы.
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
    // Lexical перехватывает paste, делает preventDefault и вставляет текст сам —
    // отсутствие настоящей нативной вставки ему не мешает.
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    )

    const deadline = Date.now() + INSERT_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      if (visibleText(el) !== before) return true
    }
    // Судим по факту, а не по тому, отменил ли кто-нибудь событие: панель по
    // этому ответу решает, класть ли текст в буфер обмена.
    return false
  }

  /**
   * Открытый чат как контекст для панели.
   *
   * Групповой чат отдаём ВМЕСТЕ с признаком `unsupported`, а не прячем: панель
   * должна объяснить человеку, почему карточки нет именно здесь. Молчание он
   * прочитал бы как поломку.
   *
   * @returns {ChatContext|null}
   */
  function readChat() {
    if (!parseMaxPath) return null
    notePath()
    const place = parseMaxPath(location.pathname)
    if (place.kind !== "chat" && place.kind !== "group") return null
    const chatId = place.chatId
    if (!chatId) return null
    return {
      channel: "max",
      chatId,
      // Мешок идентификаторов: в MAX он всегда из одного значения — канон в
      // этом канале и есть сам chatId (сервер, chat-canonical.ts). Поле шлём
      // ради единого тракта с Telegram, где канон приезжает из разметки.
      altIds: [chatId],
      peerSource: place.kind === "group" ? "групповой чат" : "адрес",
      title: readChatTitle(),
      // Телефона в MAX нет: он закрыт настройкой приватности. Сервер его от
      // этого канала и не примет (acceptsPhoneParam), но врать не будем и здесь.
      phone: null,
      unsupported: place.kind === "group" ? "group" : null,
    }
  }

  // Старт: сначала чистые модули (они покрыты тестами), потом описание канала
  // ядру. Разбор адреса обязателен — без него мы не знаем, какой чат открыт;
  // время и ключ обязательны для заливки, и без них панель работает без записи
  // переписки, а не падает.
  Promise.all([
    import(chrome.runtime.getURL("src/common/max-path.js")),
    import(chrome.runtime.getURL("src/common/max-time.js")).catch(() => null),
    import(chrome.runtime.getURL("src/common/max-message.js")).catch(() => null),
    import(chrome.runtime.getURL("src/common/selector-config.js")).catch(() => null),
  ])
    .then(([path, time, message, config]) => {
      parseMaxPath = path.parseMaxPath
      maxTime = time
      maxMessage = message
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
          // Конфиг мог приехать уже после старта скрипта — тогда селекторы
          // подменяются на лету, без перезагрузки страницы мессенджера.
          chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local" || !changes[key]) return
            applySelectorConfig(changes[key].newValue)
          })
        } catch {
          // Контекст расширения умер (обновили расширение) — работаем на
          // встроенных селекторах, как и до Шага 4.
        }
      }

      core.start({
        channel: "max",
        ready: () => Boolean(parseMaxPath),
        readChat,
        collectMessages: collectVisibleMessages,
        latestMessageKey: readLatestMessageKey,
        insertText: insertIntoComposer,
        // Смену чата ловим ОПРОСОМ адреса: SvelteKit ходит через pushState, и
        // `popstate` на программную навигацию не срабатывает вовсе. popstate
        // слушаем дополнительно — он ловит «назад» в браузере мгновенно.
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
        // Диагностика в ответе ping — её показывает строка в настройках панели.
        diag: () => ({
          path: location.pathname,
          kind: parseMaxPath ? parseMaxPath(location.pathname).kind : null,
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
