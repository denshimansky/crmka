/**
 * Probe разметки MAX (web.max.ru) — Шаг 1 Фазы 4, docs/messenger-extension.md §8.
 *
 * ЗАЧЕМ. Всё, что мы знаем о разметке MAX, получено разбором минифицированного
 * бандла, а не живой проверкой. Писать адаптер по таким данным — значит гадать.
 * Этот скрипт собирает факты за один прогон в консоли.
 *
 * БЕЗОПАСНОСТЬ. Скрипт ТОЛЬКО ЧИТАЕТ видимый DOM. Он не трогает localStorage и
 * IndexedDB (там лежит токен сессии `__oneme_auth` — именно его воруют вредные
 * расширения), ничего никуда не отправляет и ничего не пишет на страницу. В MAX
 * инъекция скриптов в саму страницу нам запрещена отдельно: CSP там Report-Only
 * с report-uri, то есть о ней узнал бы сам MAX.
 *
 * КАК ЗАПУСКАТЬ.
 *   1. Открыть web.max.ru, войти, открыть ЛИЧНЫЙ чат с клиентом.
 *   2. F12 → Console → вставить весь этот файл → Enter.
 *   3. Скрипт напечатает отчёт и положит его в буфер: copy(crmkaMaxProbe.last).
 *   4. Повторить в ГРУППЕ, в КАНАЛЕ, в «Избранном» и на экране списка чатов —
 *      формы адреса у них разные, адаптеру нужно их различать.
 *
 * ДОПОЛНИТЕЛЬНО (отдельными командами, по одной):
 *   crmkaMaxProbe.scrollCheck()  — виртуализируется ли список сообщений
 *   crmkaMaxProbe.watch()        — ловит ли MutationObserver новое сообщение
 *   crmkaMaxProbe.composer()     — будит ли Svelte вставку текста в поле ввода
 */

;(() => {
  const MAX_TEXT = 120

  /** Класс Svelte выглядит как «messageWrapper svelte-gl41bh»: хеш меняется на
   * каждой сборке, поэтому цепляться можно только за авторскую часть. */
  const byClassPart = (part) => [...document.querySelectorAll(`[class*="${part}"]`)]

  const cut = (text) => {
    const value = (text ?? "").replace(/\s+/g, " ").trim()
    return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
  }

  /** ВСЕ атрибуты узла — главный вопрос: есть ли всё-таки id сообщения. */
  const attrs = (el) =>
    Object.fromEntries([...el.attributes].map((a) => [a.name, cut(a.value)]))

  const classParts = (el) =>
    [...el.classList].filter((c) => !/^svelte-[a-z0-9]+$/i.test(c))

  const describe = (el) =>
    el
      ? {
          tag: el.tagName.toLowerCase(),
          classes: classParts(el),
          attrs: attrs(el),
          text: cut(el.textContent),
        }
      : null

  const report = {}

  // ── 1. Адрес: по нему адаптер понимает, какой чат открыт ───────────────────
  report.url = {
    href: location.href,
    pathname: location.pathname,
    segments: location.pathname.split("/").filter(Boolean),
    search: location.search || null,
    hash: location.hash || null,
    // Хэша у SvelteKit нет, навигация идёт через pushState — popstate на неё не
    // срабатывает, значит смену чата придётся ловить опросом pathname.
    title: document.title,
  }

  // ── 2. Узлы сообщений ──────────────────────────────────────────────────────
  const wrappers = byClassPart("messageWrapper")
  report.messages = {
    selector: '[class*="messageWrapper"]',
    count: wrappers.length,
    // Последние три — с ПОЛНЫМ набором атрибутов: ищем id и машинное время.
    sample: wrappers.slice(-3).map((el) => ({
      wrapper: describe(el),
      // Модификатор направления: по спайку это «--out» у исходящих.
      looksOutgoing: [...el.classList].some((c) => c.includes("out")),
      body: describe(el.querySelector('[class*="message"]')),
      meta: describe(el.querySelector('[class*="meta"]')),
      // Вдруг id всё же лежит на вложенном узле.
      nestedWithId: [...el.querySelectorAll("[id],[data-id],[data-message-id]")]
        .slice(0, 3)
        .map(describe),
    })),
  }

  // ── 3. Капсулы-разделители дат: из них собирается дата сообщения ───────────
  const capsules = [
    ...new Set([...byClassPart("capsule"), ...byClassPart("separator"), ...byClassPart("dateLabel")]),
  ]
  report.dateSeparators = {
    count: capsules.length,
    texts: capsules.slice(0, 8).map((el) => ({ classes: classParts(el), text: cut(el.textContent) })),
  }

  // ── 4. Поле ввода ──────────────────────────────────────────────────────────
  const editables = [...document.querySelectorAll('[contenteditable="true"]')]
  report.composer = {
    byTestId: describe(document.querySelector('[data-testid="composer"]')),
    editableCount: editables.length,
    editables: editables.map((el) => ({
      ...describe(el),
      visible: Boolean(el.offsetParent || el.getClientRects().length),
    })),
  }

  // ── 5. Стабильные опоры: data-testid переживают пересборку, классы — нет ───
  const testIds = [...new Set([...document.querySelectorAll("[data-testid]")].map((el) => el.dataset.testid))]
  report.testIds = { count: testIds.length, values: testIds.slice(0, 60) }

  const svelteHashes = [
    ...new Set(
      [...document.querySelectorAll('[class*="svelte-"]')]
        .flatMap((el) => [...el.classList])
        .filter((c) => /^svelte-[a-z0-9]+$/i.test(c)),
    ),
  ]
  report.svelteHashes = {
    // Их сравниваем между сборками: если меняются — remote-конфиг селекторов для
    // MAX обязателен, а не опционален.
    count: svelteHashes.length,
    sample: svelteHashes.slice(0, 10),
  }

  // ── 6. Контейнер прокрутки — нужен для проверки виртуализации ──────────────
  const scroller = wrappers[0]?.closest('[class*="scroll"], [class*="list"], [class*="messages"]') ?? null
  report.scrollContainer = scroller
    ? { ...describe(scroller), scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight }
    : null

  const api = {
    last: report,

    /**
     * Виртуализируется ли список: прокрутить вверх и сравнить число узлов.
     * Если счётчик держится примерно на месте — старые сообщения выгружаются, и
     * адаптеру нельзя рассчитывать на «всю историю в DOM».
     */
    scrollCheck() {
      const before = document.querySelectorAll('[class*="messageWrapper"]').length
      const box = scroller
      if (!box) return "Контейнер прокрутки не найден — прокрутите вручную и запустите ещё раз."
      box.scrollTop = 0
      return new Promise((resolve) =>
        setTimeout(() => {
          const after = document.querySelectorAll('[class*="messageWrapper"]').length
          resolve({
            before,
            after,
            вывод: after <= before ? "похоже на виртуализацию" : "узлы накапливаются",
          })
        }, 1500),
      )
    },

    /**
     * Ловится ли новое сообщение наблюдателем DOM. Запустить, попросить кого-то
     * написать в чат (или написать самому с телефона) — в консоль придёт строка.
     */
    watch() {
      const seen = new Set(
        [...document.querySelectorAll('[class*="messageWrapper"]')].map((el) => cut(el.textContent)),
      )
      const observer = new MutationObserver(() => {
        for (const el of document.querySelectorAll('[class*="messageWrapper"]')) {
          const key = cut(el.textContent)
          if (seen.has(key)) continue
          seen.add(key)
          console.log("[max-probe] новое сообщение:", { text: key, attrs: attrs(el) })
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      console.log("[max-probe] наблюдатель включён. Выключить: crmkaMaxProbe.stop()")
      api._observer = observer
      return "жду новое сообщение…"
    },

    stop() {
      api._observer?.disconnect()
      return "наблюдатель выключен"
    },

    /**
     * Будит ли Svelte вставку через execCommand. ВНИМАНИЕ: текст появится в поле
     * ввода — НЕ нажимайте Enter, просто сотрите его после проверки. Ничего не
     * отправляется: расширение принципиально не отправляет сообщения само.
     */
    composer() {
      const el = editables.find((node) => node.offsetParent || node.getClientRects().length)
      if (!el) return "Видимое поле ввода не найдено"
      el.focus()
      const before = el.textContent ?? ""
      document.execCommand("insertText", false, "проверка вставки")
      const after = el.textContent ?? ""
      return {
        сработало: after !== before,
        было: cut(before),
        стало: cut(after),
        подсказка: "Сотрите текст руками. Кнопка отправки должна была стать активной.",
      }
    },
  }

  window.crmkaMaxProbe = api
  console.log("%c[max-probe] отчёт", "font-weight:bold", report)
  try {
    // В Chrome copy() кладёт в буфер обмена — отчёт сразу можно вставить в чат.
    copy(JSON.stringify(report, null, 2))
    console.log("[max-probe] отчёт скопирован в буфер обмена")
  } catch {
    console.log("[max-probe] буфер недоступен — выполните: copy(JSON.stringify(crmkaMaxProbe.last, null, 2))")
  }
  return report
})()
