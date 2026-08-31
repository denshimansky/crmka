/**
 * Probe разметки MAX (web.max.ru) — Шаг 1 Фазы 4, docs/messenger-extension.md §8.
 *
 * ЗАЧЕМ. Всё, что мы знаем о разметке MAX, получено разбором минифицированного
 * бандла, а не живой проверкой. Писать адаптер по таким данным — значит гадать.
 * Этот скрипт собирает факты за один прогон в консоли.
 *
 * ВЕРСИЯ 2 (31.08.2026) — по итогам первого живого прогона:
 *   • подтвердилось: id сообщения в разметке НЕТ (у узла только role и class);
 *   • направление помечается «messageWrapper--isOut» — с ЗАГЛАВНОЙ O, поэтому
 *     регистрозависимая проверка на «out» его не находила;
 *   • `[data-testid="composer"]` — это div-обёртка, а contenteditable на странице
 *     не оказалось вовсе. Значит поле ввода устроено иначе, чем в Telegram, и
 *     способ вставки текста придётся выбирать другой. Этим v2 и занимается.
 *
 * БЕЗОПАСНОСТЬ. Скрипт ТОЛЬКО ЧИТАЕТ видимый DOM. Он не трогает localStorage и
 * IndexedDB (там лежит токен сессии `__oneme_auth` — именно его воруют вредные
 * расширения), ничего никуда не отправляет и ничего не пишет на страницу. В MAX
 * инъекция скриптов в саму страницу нам запрещена отдельно: CSP там Report-Only
 * с report-uri, то есть о ней узнал бы сам MAX.
 *
 * КАК ЗАПУСКАТЬ.
 *   1. Открыть web.max.ru, войти, открыть чат, где есть переписка В ОБЕ СТОРОНЫ
 *      и хотя бы за два разных дня.
 *   2. F12 → Console → «allow pasting» → вставить весь файл → Enter.
 *   3. Отчёт ляжет в буфер: copy(JSON.stringify(crmkaMaxProbe.last, null, 2)).
 *   4. Повторить в ГРУППЕ, в КАНАЛЕ, в «Избранном» и на списке чатов — формы
 *      адреса у них разные, адаптеру нужно их различать.
 *
 * ДОПОЛНИТЕЛЬНО (по одной команде за раз):
 *   crmkaMaxProbe.composerDeep()  — из чего сделано поле ввода (главный вопрос v2)
 *   crmkaMaxProbe.tryInsert()     — какой способ вставки будит Svelte
 *   crmkaMaxProbe.scrollCheck()   — виртуализируется ли список сообщений
 *   crmkaMaxProbe.watch()         — ловит ли MutationObserver новое сообщение
 */

;(() => {
  const MAX_TEXT = 160
  const TREE_DEPTH = 4

  /** Класс Svelte выглядит как «messageWrapper svelte-1kh0oxy»: хеш меняется на
   * каждой сборке, поэтому цепляться можно только за авторскую часть. */
  const byClassPart = (part) => [...document.querySelectorAll(`[class*="${part}"]`)]

  const cut = (text) => {
    const value = (text ?? "").replace(/\s+/g, " ").trim()
    return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
  }

  const attrs = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, cut(a.value)]))

  const classParts = (el) => [...el.classList].filter((c) => !/^svelte-[a-z0-9]+$/i.test(c))

  const describe = (el) =>
    el ? { tag: el.tagName.toLowerCase(), classes: classParts(el), attrs: attrs(el), text: cut(el.textContent) } : null

  /**
   * Компактное дерево узла: нужно, чтобы понять, ГДЕ внутри пузыря лежат имя
   * отправителя, время и реакции — их придётся вычищать при сборе текста.
   * Собственный текст узла (без потомков) показывает, что именно вырезать.
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
      // Атрибуты кроме class — среди них и ищем id/время.
      attrs: Object.fromEntries(Object.entries(attrs(el)).filter(([k]) => k !== "class")),
      ownText: cut(ownText) || undefined,
      children: [...el.children].slice(0, 8).map((child) => tree(child, depth + 1)),
    }
  }

  const report = {}

  // ── 1. Адрес: по нему адаптер понимает, какой чат открыт ───────────────────
  report.url = {
    href: location.href,
    pathname: location.pathname,
    segments: location.pathname.split("/").filter(Boolean),
    search: location.search || null,
    hash: location.hash || null,
    title: document.title,
  }

  // ── 2. Узлы сообщений ──────────────────────────────────────────────────────
  const wrappers = byClassPart("messageWrapper")
  // Регистр важен: модификатор называется «--isOut», а не «--out».
  const isOut = (el) => [...el.classList].some((c) => /--isout/i.test(c))
  const outs = wrappers.filter(isOut)
  const ins = wrappers.filter((el) => !isOut(el))

  const sampleOf = (list, label) =>
    list.slice(-2).map((el) => ({
      направление: label,
      wrapper: describe(el),
      // Дерево пузыря целиком: по нему пишется вычистка текста от имени и часов.
      дерево: tree(el),
      meta: describe(el.querySelector('[class*="meta"]')),
      // Есть ли где-нибудь машинное время: подсказка title/aria-label с датой.
      подсказкиВремени: [...el.querySelectorAll("[title],[aria-label],[datetime]")]
        .slice(0, 5)
        .map((n) => ({ tag: n.tagName.toLowerCase(), title: n.getAttribute("title"), aria: n.getAttribute("aria-label"), datetime: n.getAttribute("datetime") })),
      // Главный вопрос: есть ли хоть какой-то идентификатор сообщения.
      любыеId: [...el.querySelectorAll("[id],[data-id],[data-message-id],[data-mid],[key]")]
        .slice(0, 3)
        .map(describe),
    }))

  report.messages = {
    selector: '[class*="messageWrapper"]',
    count: wrappers.length,
    исходящих: outs.length,
    входящих: ins.length,
    примеры: [...sampleOf(ins, "входящее"), ...sampleOf(outs, "исходящее")],
  }

  // ── 3. Капсулы-разделители дат ─────────────────────────────────────────────
  const capsules = [...new Set([...byClassPart("capsule"), ...byClassPart("separator"), ...byClassPart("dateLabel")])]
  report.dateSeparators = {
    count: capsules.length,
    texts: capsules.slice(0, 10).map((el) => ({ classes: classParts(el), text: cut(el.textContent) })),
  }

  // ── 4. Поле ввода — главный вопрос версии 2 ────────────────────────────────
  const composerRoot = document.querySelector('[data-testid="composer"]')
  report.composer = {
    корень: describe(composerRoot),
    дерево: tree(composerRoot),
    // contenteditable ищем в ЛЮБОМ значении атрибута, а не только «true».
    contenteditable: [...document.querySelectorAll("[contenteditable]")].map(describe),
    textarea: [...document.querySelectorAll("textarea")].map(describe),
    input: [...document.querySelectorAll('input:not([type="file"])')].map(describe),
  }

  // ── 5. Стабильные опоры ────────────────────────────────────────────────────
  report.testIds = [...new Set([...document.querySelectorAll("[data-testid]")].map((el) => el.dataset.testid))]

  const svelteHashes = [
    ...new Set(
      [...document.querySelectorAll('[class*="svelte-"]')].flatMap((el) => [...el.classList]).filter((c) => /^svelte-[a-z0-9]+$/i.test(c)),
    ),
  ]
  report.svelteHashes = { count: svelteHashes.length, sample: svelteHashes.slice(0, 10) }

  // ── 6. Контейнер прокрутки ─────────────────────────────────────────────────
  const scroller =
    wrappers[0]?.closest('[class*="scrollList"], [class*="scroll"], [class*="messages"]') ?? null
  report.scrollContainer = scroller
    ? { ...describe(scroller), scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight }
    : null

  const api = {
    last: report,

    /** Из чего сделано поле ввода: без этого способ вставки не выбрать. */
    composerDeep() {
      const root = document.querySelector('[data-testid="composer"]')
      if (!root) return "composer не найден"
      const nodes = [...root.querySelectorAll("*")].map((el) => ({
        tag: el.tagName.toLowerCase(),
        classes: classParts(el),
        attrs: Object.fromEntries(Object.entries(attrs(el)).filter(([k]) => k !== "class")),
        editable: el.isContentEditable,
        текст: cut(el.textContent),
      }))
      return { всегоУзлов: nodes.length, узлы: nodes.slice(0, 40) }
    },

    /**
     * Какой способ вставки будит Svelte. Пробуем по очереди и смотрим, изменилось
     * ли значение. ВНИМАНИЕ: текст появится в поле ввода — Enter НЕ нажимать,
     * потом стереть руками. Ничего не отправляется.
     */
    tryInsert(text = "проверка вставки") {
      const root = document.querySelector('[data-testid="composer"]')
      const target =
        root?.querySelector("textarea, input, [contenteditable]") ??
        document.querySelector("textarea, [contenteditable]")
      if (!target) return "поле ввода не найдено — сначала crmkaMaxProbe.composerDeep()"

      const kind = target.tagName.toLowerCase()
      target.focus()
      const before = kind === "textarea" || kind === "input" ? target.value : target.textContent
      const результаты = {}

      // Способ 1 — execCommand (так работает адаптер Telegram).
      document.execCommand("insertText", false, text)
      результаты.execCommand = (kind === "textarea" || kind === "input" ? target.value : target.textContent) !== before

      // Способ 2 — нативный сеттер + событие input. Так будят React/Svelte, когда
      // прямая правка value их не трогает.
      if (!результаты.execCommand && (kind === "textarea" || kind === "input")) {
        const proto = kind === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
        setter?.call(target, `${before}${text}`)
        target.dispatchEvent(new Event("input", { bubbles: true }))
        результаты.нативныйСеттер = target.value !== before
      }

      return {
        поле: { tag: kind, classes: classParts(target), editable: target.isContentEditable },
        результаты,
        подсказка: "Стереть текст руками. Активировалась ли кнопка отправки?",
      }
    },

    /** Виртуализируется ли список: прокрутить вверх и сравнить число узлов. */
    scrollCheck() {
      const box = scroller ?? document.scrollingElement
      const before = document.querySelectorAll('[class*="messageWrapper"]').length
      if (!box) return "Контейнер прокрутки не найден"
      box.scrollTop = 0
      return new Promise((resolve) =>
        setTimeout(() => {
          const after = document.querySelectorAll('[class*="messageWrapper"]').length
          resolve({ доПрокрутки: before, после: after, вывод: after <= before ? "похоже на виртуализацию" : "узлы накапливаются" })
        }, 1500),
      )
    },

    /** Ловится ли новое сообщение наблюдателем DOM. */
    watch() {
      const seen = new Set([...document.querySelectorAll('[class*="messageWrapper"]')].map((el) => cut(el.textContent)))
      const observer = new MutationObserver(() => {
        for (const el of document.querySelectorAll('[class*="messageWrapper"]')) {
          const key = cut(el.textContent)
          if (seen.has(key)) continue
          seen.add(key)
          console.log("[max-probe] новое сообщение:", { text: key, attrs: attrs(el), дерево: tree(el) })
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      api._observer = observer
      console.log("[max-probe] наблюдатель включён. Выключить: crmkaMaxProbe.stop()")
      return "жду новое сообщение…"
    },

    stop() {
      api._observer?.disconnect()
      return "наблюдатель выключен"
    },
  }

  window.crmkaMaxProbe = api
  console.log("%c[max-probe v2] отчёт", "font-weight:bold", report)
  try {
    copy(JSON.stringify(report, null, 2))
    console.log("[max-probe] отчёт скопирован в буфер обмена")
  } catch {
    console.log("[max-probe] буфер недоступен — выполните: copy(JSON.stringify(crmkaMaxProbe.last, null, 2))")
  }
  return report
})()
