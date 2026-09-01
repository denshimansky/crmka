/**
 * Проверка адаптера WhatsApp на синтетической разметке.
 *
 * Живой WhatsApp это НЕ заменяет (для него есть TESTING.md и tools/wa-probe.js):
 * селекторы здесь наши же, и если WhatsApp переименует класс, проверка
 * останется зелёной. Она ловит другое — регрессы в НАШЕЙ логике разбора:
 * направление, отбраковку служебных строк, ключ дедупа, гард неличных чатов,
 * разбор времени, вставку без отправки.
 *
 * Разметка-двойник построена по разбору прод-бандла: строка сообщения с
 * `data-id` = сериализованный MsgKey, направление авторскими классами
 * `message-in`/`message-out` на ВНУТРЕННЕМ div, время и автор в
 * `data-pre-plain-text`, текст в span с `data-testid`, содержащим токен
 * `selectable-text`, поле ввода — Lexical.
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

/** Строка сообщения — так её собирает WhatsApp (упрощённо, но по структуре). */
const row = ({ id, dir, text, pre, testid = "selectable-text", extra = "" }) => `
  <div data-id="${id}" class="focusable-list-item _akbu">
    <div class="${dir ? `message-${dir}` : ""} _amjy _amjw">
      ${
        pre
          ? `<div class="copyable-text" data-pre-plain-text="${pre}">
               <span class="_ao3e" data-testid="${testid}"><span>${text}</span></span>
               <span class="x1rg5ohu">16:04</span>
             </div>`
          : `<span class="_ao3e">${text}</span>`
      }
      ${extra}
    </div>
  </div>`

/**
 * Страница-двойник. Чат выбирается параметром `?case=`: адрес у WhatsApp не
 * меняется вовсе, и адаптер обязан узнавать чат по разметке, а не по нему.
 */
const PAGE = (kase) => {
  const bodies = {
    // Личный чат с телефонным JID: два сообщения, служебная строка, медиа без
    // подписи, строка ЧУЖОГО чата и альбом с вложенным data-id.
    personal: `
      ${row({ id: "false_79001234567@c.us_3EB0AAA", dir: "in", text: "Здравствуйте! Завтра занятие будет?", pre: "[16:04, 12.08.2026] Мама Пети: " })}
      ${row({ id: "true_79001234567@c.us_3EB0BBB", dir: "out", text: "Да, ждём вас в 17:00", pre: "[16:07, 12.08.2026] " })}
      ${row({ id: "false_79001234567@c.us_3EB0CCC", dir: null, text: "Сообщения защищены сквозным шифрованием" })}
      ${row({ id: "false_79001234567@c.us_3EB0DDD", dir: "in", text: "", pre: "[09:05, 13.08.2026] Мама Пети: " })}
      ${row({ id: "false_79990000000@c.us_3EB0EEE", dir: "in", text: "Это сообщение из другого чата", pre: "[10:00, 13.08.2026] Кто-то: " })}
      ${row({ id: "false_79001234567@c.us_3EB0FFF", dir: "in", text: "Выделено целиком", pre: "[11:00, 13.08.2026] Мама Пети: ", testid: "select-all selectable-text" })}`,
    // Групповой чат.
    group: row({
      id: "false_120363123456789012@g.us_3EB0GGG",
      dir: "in",
      text: "Всем привет",
      pre: "[12:00, 13.08.2026] Кто-то: ",
    }),
    // Чат под скрытым идентификатором: номера в JID нет, но он есть в подписи
    // входящего (несохранённый контакт).
    lid: row({
      id: "false_123456789012@lid_3EB0HHH",
      dir: "in",
      text: "Добрый день",
      pre: "[13:00, 13.08.2026] +7 900 123-45-67: ",
    }),
    // Пустой чат: строк нет вовсе.
    empty: "",
  }

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>WhatsApp</title></head>
<body>
<div id="main">
  <header><span title="Мама Пети">Мама Пети</span></header>
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

// ── Личный чат ──────────────────────────────────────────────────────────────
await load("personal")

const chat = await page.evaluate(() => window.__adapter.readChat())
check("чат распознан, JID нормализован", chat?.chatId === "79001234567@c.us", chat)
check("канал whatsapp, чат поддерживается", chat?.channel === "whatsapp" && !chat.unsupported, chat)
check("телефон взят из JID", chat?.phone === "79001234567", chat)
check("имя собеседника из шапки", chat?.title === "Мама Пети", chat?.title)

const messages = await page.evaluate(() => window.__adapter.collectMessages())
check("собрано ровно три сообщения", messages.length === 3, messages)
check(
  "направления по классам пузыря",
  messages[0]?.direction === "incoming" && messages[1]?.direction === "outgoing",
  messages.map((m) => m.direction),
)
check(
  "ключ дедупа — настоящий id сообщения",
  messages[0]?.externalId === "3EB0AAA" && messages[1]?.externalId === "3EB0BBB",
  messages.map((m) => m.externalId),
)
check(
  "время разобрано в русском формате (12.08 — это АВГУСТ)",
  messages[0]?.sentAt?.startsWith("2026-08-12T"),
  messages[0]?.sentAt,
)
check(
  "служебная строка без класса направления пропущена",
  !messages.some((m) => m.text.includes("шифрованием")),
  messages.map((m) => m.text),
)
check(
  "медиа без подписи пропущено",
  !messages.some((m) => m.externalId === "3EB0DDD"),
  messages.map((m) => m.externalId),
)
check(
  "сообщение ЧУЖОГО чата не взято",
  !messages.some((m) => m.text.includes("другого чата")),
  messages.map((m) => m.text),
)
check(
  "testid со списком токенов («select-all selectable-text») тоже читается",
  messages.some((m) => m.text === "Выделено целиком"),
  messages.map((m) => m.text),
)

const diag = await page.evaluate(() => window.__adapter.diag())
check("счётчик «чужого чата» отработал", diag?.сбор?.чужогоЧата === 1, diag?.сбор)
check("счётчик служебных отработал", diag?.сбор?.служебных === 1, diag?.сбор)

const latest = await page.evaluate(() => window.__adapter.latestMessageKey())
check("отпечаток последнего сообщения — id последней строки", latest === "3EB0FFF", latest)

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

// ── Групповой чат ───────────────────────────────────────────────────────────
await load("group")
const group = await page.evaluate(() => window.__adapter.readChat())
check("групповой чат помечен как необслуживаемый", group?.unsupported === "group", group)
check("телефон у группы не выдуман", group?.phone === null, group)
const groupMessages = await page.evaluate(() => window.__adapter.collectMessages())
check("из группового чата сообщений не берём вовсе", groupMessages.length === 0, groupMessages)

// ── Скрытый идентификатор (LID) ─────────────────────────────────────────────
await load("lid")
const lid = await page.evaluate(() => window.__adapter.readChat())
check("LID-чат обслуживается как личный", lid?.chatId === "123456789012@lid" && !lid.unsupported, lid)
check(
  "номер подобран из подписи входящего, а не выдуман из LID",
  lid?.phone === "79001234567",
  { phone: lid?.phone, peerSource: lid?.peerSource },
)

// ── Пустой чат ──────────────────────────────────────────────────────────────
await load("empty")
const empty = await page.evaluate(() => window.__adapter.readChat())
check("пустой чат — отдельная причина, а не «чат не выбран»", empty?.unsupported === "no-messages", empty)

// ── Удалённый конфиг селекторов ─────────────────────────────────────────────
// Разыгрываем аварию: WhatsApp «переименовал» класс направления. Канал должен
// чиниться правкой конфига на сервере, без публикации в стор.
await load("personal")
const before = await page.evaluate(() => window.__adapter.collectMessages().length)
await page.evaluate(() => {
  for (const node of document.querySelectorAll(".message-in, .message-out")) {
    node.className = node.className.replace("message-in", "bubble-in").replace("message-out", "bubble-out")
  }
})
const broken = await page.evaluate(() => window.__adapter.collectMessages().length)
check("переименование класса ломает канал (значит, проверка живая)", broken === 0, { before, broken })

await page.evaluate(() =>
  window.__pushConfig({
    version: 99,
    channels: { whatsapp: { incoming: ".bubble-in", outgoing: ".bubble-out" } },
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
  fixed[0]?.externalId === "3EB0AAA",
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
