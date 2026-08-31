/**
 * Одноразовая проверка адаптера MAX на синтетической разметке.
 *
 * Живой MAX заменить нельзя (это в TESTING.md), но логику разбора — можно:
 * поднимаем страницу с разметкой, повторяющей факты probe (пузыри
 * «messageWrapper», направление в data-bubbles-variant, часы в `.meta`, дата в
 * капсуле), грузим НАСТОЯЩИЕ adapter-core.js и max.js и смотрим, что адаптер
 * из этого достаёт. Заодно проверяем вставку через синтетический paste в поле,
 * которое ведёт себя как Lexical.
 *
 * Запуск (playwright лежит в зависимостях приложения, как у panel-preview.mjs):
 *   cd app && node ../extension/tools/max-adapter-check.mjs
 *
 * Живой MAX это НЕ заменяет: селекторы здесь наши же, и если MAX переименует
 * класс, проверка останется зелёной. Она ловит другое — регрессы в нашей логике
 * разбора: направление, время, ключ дедупа, гард группового чата.
 */
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const EXTENSION_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..")
// Playwright живёт в зависимостях приложения, а не расширения (у расширения
// сборки нет вовсе) — резолвим вручную от app/package.json.
const require = createRequire(path.join(EXTENSION_ROOT, "..", "app", "package.json"))
const { chromium } = require("@playwright/test")
const CHROMIUM =
  process.env.CHROMIUM_PATH || "C:/Users/Cyberjinn/AppData/Local/Chromium/Application/chrome.exe"

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }

// Разметка-двойник MAX. Классы Svelte с хешем — как на живой странице.
const PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Мария Иванова — MAX</title></head>
<body>
<header class="chatHeader svelte-aa11"><div class="title svelte-bb22">Мария Иванова</div></header>
<div class="scrollList svelte-cc33" id="list">
  <div class="capsuleSeparator svelte-dd44"><span>2 июля 2026</span></div>

  <div class="messageWrapper svelte-ee55" role="presentation">
    <div class="message svelte-ff66" data-bubbles-variant="incoming">
      <div class="messageText">Здравствуйте! Завтра занятие будет?</div>
      <span class="meta svelte-gg77">16:15</span>
    </div>
  </div>

  <div class="messageWrapper messageWrapper--isOut svelte-ee55" role="presentation">
    <div class="message svelte-ff66" data-bubbles-variant="outgoing">
      <div class="messageText">Да, ждём вас в 17:00</div>
      <span class="meta svelte-gg77">16:20 ✓✓</span>
    </div>
  </div>

  <div class="unreadSeparator svelte-hh88">Непрочитанные</div>

  <div class="capsuleSeparator svelte-dd44"><span>Сегодня</span></div>

  <div class="messageWrapper svelte-ee55" role="presentation">
    <div class="message svelte-ff66" data-bubbles-variant="incoming">
      <div class="messageText">Пропущенный вызов Аудио</div>
      <span class="meta svelte-gg77">09:01</span>
    </div>
  </div>

  <div class="messageWrapper svelte-ee55" role="presentation">
    <div class="message svelte-ff66" data-bubbles-variant="incoming">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="">
      <span class="meta svelte-gg77">09:05</span>
    </div>
  </div>

  <div class="messageWrapper svelte-ee55" role="presentation">
    <div class="message svelte-ff66">
      <div class="messageText">Пузырь без направления — его брать нельзя</div>
      <span class="meta svelte-gg77">09:07</span>
    </div>
  </div>

  <div class="messageWrapper svelte-ee55" role="presentation">
    <div class="message svelte-ff66" data-bubbles-variant="incoming">
      <div class="reply svelte-ii99">Да, ждём вас в 17:00</div>
      <div class="messageText">А во сколько именно?
Спасибо!</div>
      <span class="meta svelte-gg77">09:10</span>
    </div>
  </div>
</div>

<div data-testid="composer" class="composer svelte-jj00">
  <div class="contenteditable svelte-kk11" contenteditable="" role="textbox" data-lexical-editor="true"></div>
</div>
<script>
  // Двойник Lexical: перехватывает paste, отменяет событие и вставляет сам.
  const field = document.querySelector('[data-lexical-editor="true"]')
  field.addEventListener("paste", (event) => {
    if (!window.__lexicalAccepts) return
    event.preventDefault()
    const text = event.clipboardData.getData("text/plain")
    for (const line of text.split("\\n")) {
      const p = document.createElement("p")
      p.textContent = line
      field.appendChild(p)
    }
  })
  window.__lexicalAccepts = true
</script>
</body></html>`

const server = http.createServer((req, res) => {
  const url = decodeURI(req.url.split("?")[0])
  const file = path.join(EXTENSION_ROOT, url)
  // Файлы расширения отдаём как есть, всё остальное — страница-двойник MAX:
  // так location.pathname выглядит как настоящий адрес чата («/437719203»).
  if (url.startsWith("/src/") && fs.existsSync(file)) {
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" })
    res.end(fs.readFileSync(file))
    return
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(PAGE)
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
  }
}, origin)

const results = {}
const problems = []
/** @param {string} name @param {boolean} ok @param {unknown} [details] */
function check(name, ok, details) {
  results[name] = ok ? "ок" : "ПРОВАЛ"
  if (!ok) problems.push({ name, details })
  console.log(`${ok ? "✔" : "✖"} ${name}`, ok ? "" : JSON.stringify(details, null, 2) ?? "")
}

// ── Личный чат ─────────────────────────────────────────────────────────────
await page.goto(`${origin}/437719203`)
await page.addScriptTag({ url: `${origin}/src/content/adapter-core.js` })
// Перехватываем описание адаптера, но запускаем НАСТОЯЩЕЕ ядро: так проверяется
// и связка «ядро ↔ адаптер», в том числе асинхронный ответ на insert-text.
await page.evaluate(() => {
  const core = window.__crmkaAdapterCore
  const realStart = core.start
  core.start = (adapter) => {
    window.__adapter = adapter
    realStart(adapter)
  }
})
await page.addScriptTag({ url: `${origin}/src/content/max.js` })
await page.waitForFunction(() => Boolean(window.__adapter), null, { timeout: 5000 })
// Ждём окно «кадра перехода» (SETTLE_MS): раньше него сбор штатно пуст.
await page.waitForTimeout(900)

const chat = await page.evaluate(() => window.__adapter.readChat())
check("чат распознан как личный", chat?.chatId === "437719203" && !chat.unsupported, chat)
check("канал max, телефон не выдуман", chat?.channel === "max" && chat?.phone === null, chat)
check("имя собеседника из шапки", chat?.title === "Мария Иванова", chat?.title)

const messages = await page.evaluate(() => window.__adapter.collectMessages())
check("собраны только настоящие сообщения", messages.length === 3, messages)
check(
  "направления не перепутаны",
  messages.map((m) => m.direction).join(",") === "incoming,outgoing,incoming",
  messages.map((m) => m.direction),
)
check(
  "часы не приклеились к тексту",
  messages[0]?.text === "Здравствуйте! Завтра занятие будет?",
  messages[0]?.text,
)
check(
  "дата из капсулы, часы из пузыря",
  messages[0]?.sentAt?.length > 0 &&
    new Date(messages[0].sentAt).getFullYear() === 2026 &&
    new Date(messages[0].sentAt).getMonth() === 6 &&
    new Date(messages[0].sentAt).getDate() === 2 &&
    new Date(messages[0].sentAt).getHours() === 16 &&
    new Date(messages[0].sentAt).getMinutes() === 15,
  messages[0]?.sentAt,
)
check(
  "«Непрочитанные» не сбили дату следующих сообщений",
  new Date(messages[2].sentAt).toDateString() === new Date().toDateString(),
  messages[2]?.sentAt,
)
check("цитата в текст не попала", !messages[2]?.text.includes("ждём вас"), messages[2]?.text)
check("перенос строки в тексте сохранён", messages[2]?.text.includes("\n"), messages[2]?.text)
check(
  "ключ версионный и разный у разных сообщений",
  messages.every((m) => m.externalId.startsWith("m1-")) &&
    new Set(messages.map((m) => m.externalId)).size === 3,
  messages.map((m) => m.externalId),
)

const secondRun = await page.evaluate(() => window.__adapter.collectMessages())
check(
  "повторный сбор даёт те же ключи (иначе дубли в карточке)",
  JSON.stringify(secondRun.map((m) => m.externalId)) ===
    JSON.stringify(messages.map((m) => m.externalId)),
  { secondRun: secondRun.map((m) => m.externalId) },
)

const diag = await page.evaluate(() => window.__adapter.diag())
check(
  "диагностика считает пропуски",
  diag["сбор"]["служебных"] === 1 &&
    diag["сбор"]["безНаправления"] === 1 &&
    diag["сбор"]["пустых"] === 1,
  diag,
)

// Разметку MAX мы видели только плоской, но SvelteKit вполне может обернуть
// день в свой блок — и тогда капсула с датой окажется СНАРУЖИ группы пузырей.
// Наивный «родитель пузырей» в этом случае не увидел бы ни одной даты, а без
// даты сообщение не заливается: канал молча перестал бы работать целиком.
const grouped = await page.evaluate(() => {
  const list = document.getElementById("list")
  const groups = []
  let current = null
  for (const node of [...list.children]) {
    if (/capsule/.test(node.className)) {
      current = document.createElement("div")
      current.className = "dayGroup svelte-zz99"
      list.insertBefore(current, node.nextSibling)
      continue
    }
    if (current && /messageWrapper/.test(node.className)) current.appendChild(node)
  }
  groups.push(...list.querySelectorAll(".dayGroup"))
  return {
    групп: groups.length,
    сообщения: window.__adapter.collectMessages(),
  }
})
check(
  "день в отдельном блоке: сообщения и даты на месте",
  grouped.групп === 2 &&
    grouped.сообщения.length === 3 &&
    new Date(grouped.сообщения[0].sentAt).getDate() === 2,
  grouped,
)
check(
  "и ключи те же, что при плоской разметке",
  JSON.stringify(grouped.сообщения.map((m) => m.externalId)) ===
    JSON.stringify(messages.map((m) => m.externalId)),
  grouped.сообщения.map((m) => m.externalId),
)

// ── Вставка текста ─────────────────────────────────────────────────────────
const inserted = await page.evaluate(async () => {
  const ok = await window.__adapter.insertText("строка один\nстрока два")
  return { ok, text: document.querySelector('[data-lexical-editor="true"]').innerText }
})
check("вставка через синтетический paste принята", inserted.ok === true, inserted)
check(
  "перенос строки не потерян",
  inserted.text.includes("строка один") && inserted.text.includes("строка два"),
  inserted.text,
)

// Ответ ядра на insert-text должен быть асинхронным (Lexical реконсилирует DOM
// на микротаске) — синхронное «вставилось» было бы враньём панели.
const viaCore = await page.evaluate(async () => {
  const listener = window.__listeners[0]
  return await new Promise((resolve) => {
    const keepOpen = listener({ type: "insert-text", text: "через ядро" }, {}, (response) =>
      resolve({ keepOpen, response }),
    )
  })
})
check(
  "ядро дожидается ответа адаптера",
  viaCore.keepOpen === true && viaCore.response.inserted === true,
  viaCore,
)

const refused = await page.evaluate(async () => {
  window.__lexicalAccepts = false
  return await window.__adapter.insertText("редактор не принял")
})
check("редактор не принял — честный отказ (панель отдаст буфер обмена)", refused === false, refused)

// ── Групповой чат ──────────────────────────────────────────────────────────
await page.evaluate(() => history.pushState({}, "", "/-78377804395205"))
await page.waitForTimeout(900)
const group = await page.evaluate(() => ({
  chat: window.__adapter.readChat(),
  messages: window.__adapter.collectMessages(),
}))
check("группа помечена как необслуживаемая", group.chat?.unsupported === "group", group.chat)
check("из группы не собрано ни одного сообщения", group.messages.length === 0, group.messages)

// ── Список чатов ───────────────────────────────────────────────────────────
await page.evaluate(() => history.pushState({}, "", "/"))
await page.waitForTimeout(900)
const empty = await page.evaluate(() => ({
  chat: window.__adapter.readChat(),
  messages: window.__adapter.collectMessages(),
}))
check("на списке чатов чата нет", empty.chat === null, empty.chat)
check("и сообщений тоже", empty.messages.length === 0, empty.messages)

// ── Смена чата долетает до ядра ────────────────────────────────────────────
await page.evaluate(() => history.pushState({}, "", "/437719204"))
await page.waitForTimeout(1200)
const reported = await page.evaluate(() =>
  window.__sentToWorker.filter((m) => m.type === "chat-changed").map((m) => m.chat?.chatId ?? null),
)
check("ядро узнало о смене чата опросом адреса", reported.includes("437719204"), reported)

await browser.close()
server.close()

console.log("\nИтог:", JSON.stringify(results, null, 2))
if (problems.length) {
  console.log("\nПровалы:", JSON.stringify(problems, null, 2))
  process.exitCode = 1
}
