/**
 * Проверка адаптера WhatsApp на синтетической разметке.
 *
 * Живой WhatsApp это НЕ заменяет (для него есть TESTING.md и tools/wa-probe.js):
 * селекторы здесь наши же, и если WhatsApp переименует класс, проверка
 * останется зелёной. Она ловит другое — регрессы в НАШЕЙ логике разбора:
 * направление, отбраковку служебных строк, ключ дедупа, гард неличных чатов,
 * разбор времени, вставку без отправки.
 *
 * Разметка-двойник построена по ЖИВОМУ ПРОГОНУ 01.09.2026, а не по разбору
 * бандла — тот ошибся во всём главном. Здесь воспроизведено то, что видно на
 * настоящей странице: `data-id` — голый идентификатор сообщения; классов
 * направления нет, есть «хвостик» и только у первого сообщения серии; признак
 * настоящего сообщения — контейнер `msg-container`; время и автор в
 * `data-pre-plain-text`; идентификатора чата нет нигде, и опознать собеседника
 * можно лишь по номеру в заголовке.
 *
 * Запуск (playwright лежит в зависимостях приложения, как у panel-preview.mjs):
 *   cd app && node ../extension/tools/wa-adapter-check.mjs
 */
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const EXTENSION_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..")
const require = createRequire(path.join(EXTENSION_ROOT, "..", "app", "package.json"))
const { chromium } = require("@playwright/test")
const CHROMIUM =
  process.env.CHROMIUM_PATH || "C:/Users/Cyberjinn/AppData/Local/Chromium/Application/chrome.exe"

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }

/**
 * Строка сообщения — по РАЗМЕТКЕ ЖИВОГО WhatsApp (прогон 01.09.2026), а не по
 * прежним догадкам из бандла. Ключевое, что отсюда видно:
 *   • `data-id` — голый идентификатор сообщения, без чата и направления;
 *   • классов `message-in`/`message-out` нет вовсе;
 *   • направление — «хвостик» `data-icon="tail-out"`/`tail-in`, и он есть
 *     ТОЛЬКО у первого сообщения в серии подряд идущих (tail: false);
 *   • подпись автора для скринридера: «Вы:» либо «<имя собеседника>:»;
 *   • признак настоящего сообщения — контейнер `data-testid="msg-container"`.
 *
 * @param {object} o
 * @param {string} o.id
 * @param {"out"|"in"|null} o.dir Направление; null — служебная строка.
 * @param {boolean} [o.tail] Рисовать ли хвостик (первое сообщение серии).
 * @param {string} [o.author] Подпись автора, как её даёт WhatsApp.
 */
const row = ({ id, dir, text, pre, tail = true, author, testid = "selectable-text" }) => `
  <div tabindex="-1" data-id="${id}" data-testid="conv-msg-${id}">
    <div data-virtualized="false"><div><div class="focusable-list-item">
      ${author ? `<span aria-label="${author}"></span>` : ""}
      ${
        dir === null
          ? `<div>${text}</div>`
          : `<div data-testid="msg-container">
               ${tail ? `<span data-testid="tail-${dir}" data-icon="tail-${dir}"></span>` : ""}
               ${
                 pre
                   ? `<div class="copyable-text" data-pre-plain-text="${pre}">
                        <span class="_ao3e" data-testid="${testid}"><span>${text}</span></span>
                        <span class="x1rg5ohu">16:04</span>
                      </div>`
                   : `<span class="_ao3e">${text}</span>`
               }
             </div>`
      }
    </div></div></div>
  </div>`

/**
 * Страница-двойник. Чат выбирается параметром `?case=`: адрес у WhatsApp не
 * меняется вовсе, и адаптер обязан узнавать чат по разметке, а не по нему.
 */
const PAGE = (kase) => {
  // Заголовок чата — единственный источник идентификатора: у НЕсохранённого
  // контакта WhatsApp пишет там номер, у сохранённого — имя из телефонной книги.
  const titles = {
    unsaved: "+7 900 123-45-67",
    saved: "Мама Пети",
    group: "Группа «Родители 2Б»",
    empty: "+7 900 123-45-67",
  }
  const title = titles[kase] ?? titles.unsaved

  const bodies = {
    // Несохранённый контакт: номер виден в заголовке, панель работает.
    // Внутри — серия подряд идущих входящих (у второго хвоста НЕТ), служебная
    // строка, медиа без подписи и текст с составным значением testid.
    unsaved: `
      ${row({ id: "3EB0AAA1C2D3E4F50001", dir: "in", author: `${titles.unsaved}:`, text: "Здравствуйте! Завтра занятие будет?", pre: "[16:04, 12.08.2026] +7 900 123-45-67: " })}
      ${row({ id: "3EB0BBB1C2D3E4F50002", dir: "in", tail: false, author: `${titles.unsaved}:`, text: "Или уже отменили?", pre: "[16:05, 12.08.2026] +7 900 123-45-67: " })}
      ${row({ id: "3EB0CCC1C2D3E4F50003", dir: "out", author: "Вы:", text: "Да, ждём вас в 17:00", pre: "[16:07, 12.08.2026] Дмитрий Малафеев: " })}
      ${row({ id: "3EB0DDD1C2D3E4F50004", dir: null, text: "Сообщения защищены сквозным шифрованием" })}
      ${row({ id: "3EB0EEE1C2D3E4F50005", dir: "in", author: `${titles.unsaved}:`, text: "", pre: "[09:05, 13.08.2026] +7 900 123-45-67: " })}
      ${row({ id: "3EB0FFF1C2D3E4F50006", dir: "in", tail: false, author: `${titles.unsaved}:`, text: "Выделено целиком", pre: "[11:00, 13.08.2026] +7 900 123-45-67: ", testid: "select-all selectable-text" })}`,
    // Сохранённый контакт: в заголовке имя, номера нет нигде — опознать нечем.
    saved: `
      ${row({ id: "3EB01111C2D3E4F50007", dir: "in", author: `${titles.saved}:`, text: "Здравствуйте", pre: "[16:04, 12.08.2026] Мама Пети: " })}
      ${row({ id: "3EB02221C2D3E4F50008", dir: "out", author: "Вы:", text: "Добрый день", pre: "[16:07, 12.08.2026] Дмитрий Малафеев: " })}`,
    // Групповой чат: в заголовке название группы, номера нет.
    group: row({
      id: "3AB0GGG1C2D3E4F50009",
      dir: "in",
      author: "Иван Петров:",
      text: "Всем привет",
      pre: "[12:00, 13.08.2026] Иван Петров: ",
    }),
    // Чат без сообщений.
    empty: "",
  }

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>WhatsApp</title></head>
<body>
<div id="main" data-testid="conversation-panel-wrapper">
  <header data-testid="conversation-header">
    <div role="button"><span dir="auto">${title}</span></div>
  </header>
  <div data-tab="8" id="list">${bodies[kase] ?? ""}</div>
  <footer>
    <div class="lexical-rich-text-input">
      <div contenteditable="true" role="textbox" data-tab="10" data-lexical-editor="true"><p><br></p></div>
    </div>
    <button data-tab="11" aria-label="Отправить"><span data-icon="send"></span></button>
  </footer>
</div>
<script>
  // Двойник Lexical: перехватывает paste, сам раскладывает текст по абзацам и
  // НЕ реагирует на execCommand — как настоящий.
  const field = document.querySelector('[data-lexical-editor="true"]')
  field.addEventListener("paste", (event) => {
    event.preventDefault()
    const text = event.clipboardData.getData("text/plain")
    text.split("\\n").forEach((line) => {
      const p = document.createElement("p")
      p.textContent = line
      field.appendChild(p)
    })
  })
</script>
</body></html>`
}

const server = http.createServer((req, res) => {
  const [rawUrl, query] = decodeURI(req.url).split("?")
  const file = path.join(EXTENSION_ROOT, rawUrl)
  if (rawUrl.startsWith("/src/") && fs.existsSync(file)) {
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" })
    res.end(fs.readFileSync(file))
    return
  }
  const kase = new URLSearchParams(query || "").get("case") || "personal"
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(PAGE(kase))
})
await new Promise((resolve) => server.listen(0, resolve))
const origin = `http://localhost:${server.address().port}`

const browser = await chromium.launch({ executablePath: CHROMIUM })
const page = await browser.newPage()
page.on("console", (m) => {
  if (m.type() === "error") console.log("  [консоль]", m.text())
})

await page.addInitScript((base) => {
  const listeners = []
  const sent = []
  window.__sentToWorker = sent
  window.__listeners = listeners
  const store = {}
  const storageListeners = []
  window.chrome = {
    runtime: {
      id: "test",
      getURL: (p) => `${base}/${p}`,
      sendMessage: (message) => {
        sent.push(message)
        return Promise.resolve()
      },
      onMessage: { addListener: (fn) => listeners.push(fn) },
    },
    storage: {
      local: {
        get: (key) => Promise.resolve({ [key]: store[key] }),
        set: (patch) => {
          Object.assign(store, patch)
          return Promise.resolve()
        },
      },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
  }
  window.__pushConfig = (value) => {
    store.selectorConfig = value
    for (const fn of storageListeners) fn({ selectorConfig: { newValue: value } }, "local")
  }
}, origin)

const problems = []
/** @param {string} name @param {boolean} ok @param {unknown} [details] */
function check(name, ok, details) {
  if (!ok) problems.push({ name, details })
  console.log(`${ok ? "✔" : "✖"} ${name}`, ok ? "" : JSON.stringify(details, null, 2) ?? "")
}

/** Загрузить страницу-двойник и поднять на ней настоящее ядро с адаптером. */
async function load(kase) {
  await page.goto(`${origin}/?case=${kase}`)
  await page.addScriptTag({ url: `${origin}/src/content/adapter-core.js` })
  await page.evaluate(() => {
    const core = window.__crmkaAdapterCore
    const realStart = core.start
    core.start = (adapter) => {
      window.__adapter = adapter
      realStart(adapter)
    }
  })
  await page.addScriptTag({ url: `${origin}/src/content/whatsapp.js` })
  await page.waitForFunction(() => Boolean(window.__adapter), null, { timeout: 5000 })
}

/** После смены чата адаптер выжидает окно «кадра перехода» (SETTLE_MS). */
const settle = () => page.waitForTimeout(900)

// ── Несохранённый контакт: номер виден в заголовке ──────────────────────────
await load("unsaved")
await settle()

const chat = await page.evaluate(() => window.__adapter.readChat())
check("чат опознан по номеру из заголовка", chat?.chatId === "79001234567@c.us", chat)
check("канал whatsapp, чат поддерживается", chat?.channel === "whatsapp" && !chat.unsupported, chat)
check("телефон отдан наружу", chat?.phone === "79001234567", chat)
check("имя собеседника из шапки", chat?.title === "+7 900 123-45-67", chat?.title)

const messages = await page.evaluate(() => window.__adapter.collectMessages())
check("собрано ровно четыре сообщения", messages.length === 4, messages)
check(
  "направление по хвостику пузыря",
  messages[0]?.direction === "incoming" && messages[2]?.direction === "outgoing",
  messages.map((m) => m.direction),
)
check(
  "второе сообщение серии БЕЗ хвоста тоже входящее",
  messages[1]?.externalId === "3EB0BBB1C2D3E4F50002" && messages[1]?.direction === "incoming",
  messages.map((m) => `${m.externalId}:${m.direction}`),
)
check(
  "ключ дедупа — настоящий id сообщения",
  messages[0]?.externalId === "3EB0AAA1C2D3E4F50001" && messages[2]?.externalId === "3EB0CCC1C2D3E4F50003",
  messages.map((m) => m.externalId),
)
check(
  "время разобрано в русском формате (12.08 — это АВГУСТ)",
  messages[0]?.sentAt?.startsWith("2026-08-12T"),
  messages[0]?.sentAt,
)
check(
  "служебная строка без контейнера пузыря пропущена",
  !messages.some((m) => m.text.includes("шифрованием")),
  messages.map((m) => m.text),
)
check(
  "медиа без подписи пропущено",
  !messages.some((m) => m.externalId === "3EB0EEE1C2D3E4F50005"),
  messages.map((m) => m.externalId),
)
check(
  // Часы лежат в СОСЕДНЕМ узле, и наивный textContent приклеил бы их к тексту
  // («Или уже отменили?16:04») — так было и в Telegram, и в MAX. Сравниваем
  // точно, а не регуляркой «не заканчивается временем»: сообщение вполне может
  // легитимно кончаться временем («Да, ждём вас в 17:00»).
  "часы не приклеились к тексту",
  messages[1]?.text === "Или уже отменили?",
  messages.map((m) => m.text),
)
check(
  "testid со списком токенов («select-all selectable-text») тоже читается",
  messages.some((m) => m.text === "Выделено целиком"),
  messages.map((m) => m.text),
)

const diag = await page.evaluate(() => window.__adapter.diag())
check("счётчик служебных отработал", diag?.сбор?.служебных === 1, diag?.сбор)
check("счётчик пустых отработал", diag?.сбор?.пустых === 1, diag?.сбор)

const latest = await page.evaluate(() => window.__adapter.latestMessageKey())
check("отпечаток последнего сообщения — id последней строки", latest === "3EB0FFF1C2D3E4F50006", latest)

// ── Вставка текста ──────────────────────────────────────────────────────────
const inserted = await page.evaluate(() => window.__adapter.insertText("строка один\nстрока два"))
const composerText = await page.evaluate(
  () => document.querySelector('[data-lexical-editor="true"]').innerText,
)
check("вставка через синтетический paste принята", inserted === true, { inserted, composerText })
check(
  "переносы строк сохранены (execCommand их терял бы)",
  composerText.includes("строка один") && composerText.includes("строка два"),
  composerText,
)

// ── Сохранённый контакт: в заголовке имя, опознать нечем ────────────────────
await load("saved")
await settle()
const saved = await page.evaluate(() => window.__adapter.readChat())
check("сохранённый контакт — отдельная причина отказа", saved?.unsupported === "no-id", saved)
check(
  "имя за идентификатор НЕ выдаём (два тёзки схлопнулись бы необратимо)",
  saved?.chatId === "" && saved?.phone === null,
  saved,
)
check("имя при этом показываем — человеку нужно понимать, о ком речь", saved?.title === "Мама Пети", saved)
const savedMessages = await page.evaluate(() => window.__adapter.collectMessages())
check("из неопознанного чата сообщений не берём вовсе", savedMessages.length === 0, savedMessages)

// ── Групповой чат ───────────────────────────────────────────────────────────
// Сегодня группа отсекается тем же правилом: в заголовке название, а не номер.
await load("group")
await settle()
const group = await page.evaluate(() => window.__adapter.readChat())
check("групповой чат не обслуживается", Boolean(group?.unsupported), group)
check("телефон у группы не выдуман", group?.phone === null, group)
const groupMessages = await page.evaluate(() => window.__adapter.collectMessages())
check("из группового чата сообщений не берём вовсе", groupMessages.length === 0, groupMessages)

// ── Пустой чат ──────────────────────────────────────────────────────────────
// Заголовок с номером есть, сообщений нет — чат опознан, собирать нечего.
await load("empty")
await settle()
const empty = await page.evaluate(() => window.__adapter.readChat())
check("пустой чат с видимым номером опознаётся", empty?.chatId === "79001234567@c.us", empty)
const emptyMessages = await page.evaluate(() => window.__adapter.collectMessages())
check("и сообщений в нём ноль", emptyMessages.length === 0, emptyMessages)

// ── Удалённый конфиг селекторов ─────────────────────────────────────────────
// Разыгрываем аварию: WhatsApp «переименовал» контейнер пузыря, по которому мы
// отличаем сообщение от служебной строки. Канал должен чиниться правкой конфига
// на сервере, без публикации в стор с многодневным ревью.
await load("unsaved")
await settle()
const before = await page.evaluate(() => window.__adapter.collectMessages().length)
await page.evaluate(() => {
  for (const node of document.querySelectorAll('[data-testid="msg-container"]')) {
    node.setAttribute("data-testid", "bubble-container")
  }
})
const broken = await page.evaluate(() => window.__adapter.collectMessages().length)
check("переименование опоры ломает канал (значит, проверка живая)", broken === 0, { before, broken })

await page.evaluate(() =>
  window.__pushConfig({
    version: 99,
    channels: { whatsapp: { bubble: '[data-testid="bubble-container"]' } },
  }),
)
await page.waitForTimeout(100)
const fixed = await page.evaluate(() => window.__adapter.collectMessages())
check("конфиг селекторов чинит канал на лету", fixed.length === before, {
  before,
  fixed: fixed.length,
})
check(
  "и ключи дедупа при этом ТЕ ЖЕ (иначе в карточке появятся вторые строки)",
  fixed[0]?.externalId === "3EB0AAA1C2D3E4F50001",
  fixed.map((m) => m.externalId),
)

const configDiag = await page.evaluate(() => window.__adapter.diag())
check(
  "диагностика показывает применённый конфиг",
  String(configDiag?.селекторы).includes("v99"),
  configDiag?.селекторы,
)

await page.evaluate(() => window.__pushConfig({ version: 100, channels: { whatsapp: { row: "((" } } }))
await page.waitForTimeout(100)
const rejected = await page.evaluate(() => window.__adapter.diag())
check(
  "неразбирающийся селектор отклонён и это видно в диагностике",
  String(rejected?.селекторы).includes("ОТКЛОНЕНО"),
  rejected?.селекторы,
)

await browser.close()
server.close()

console.log(
  problems.length
    ? `\nПРОВАЛОВ: ${problems.length}`
    : "\nВсе проверки пройдены. Живой WhatsApp это не заменяет — см. TESTING.md.",
)
process.exit(problems.length ? 1 : 0)
