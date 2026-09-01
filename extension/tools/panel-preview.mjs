/**
 * Скриншоты панели без установки расширения — быстрая проверка вёрстки.
 *
 * Зачем: панель узкая и живёт в тёмной теме мессенджера, а ошибки в ней видно
 * только глазами — так уже всплыли форма, висевшая раскрытой (`display: flex`
 * перебивал атрибут `hidden`), чёрная иконка календаря на чёрном фоне и кнопка
 * «Сохранить» во всю ширину. Прогон занимает секунды, ручная проверка в
 * браузере — минуты.
 *
 * Что проверяет: только разметку и стили. chrome.* здесь заглушены, поэтому
 * логика (запросы к CRM, вставка в поле ввода) проверяется по extension/TESTING.md
 * с настоящим расширением.
 *
 * Запуск (playwright лежит в зависимостях приложения):
 *   cd app && node ../extension/tools/panel-preview.mjs [папка-для-скриншотов]
 *
 * Браузер: свой Chromium (playwright-браузеры не скачаны), путь переопределяется
 * переменной CHROMIUM_PATH.
 */
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const EXTENSION_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..")

// Playwright живёт в зависимостях приложения, а не расширения (у расширения
// сборки нет вовсе). Node ищет пакеты рядом со скриптом, поэтому резолвим
// вручную от app/package.json — иначе скрипт работал бы только из app/.
const require = createRequire(path.join(EXTENSION_ROOT, "..", "app", "package.json"))
const { chromium } = require("@playwright/test")
const OUT_DIR = process.argv[2] || path.join(EXTENSION_ROOT, "tools", "screenshots")
const CHROMIUM =
  process.env.CHROMIUM_PATH ||
  "C:/Users/Cyberjinn/AppData/Local/Chromium/Application/chrome.exe"

// ES-модули по file:// Chromium не грузит (opaque origin) — раздаём папку по http.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }
const server = http.createServer((req, res) => {
  const file = path.join(EXTENSION_ROOT, decodeURI(req.url.split("?")[0]))
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "text/plain" })
    res.end(data)
  })
})
await new Promise((resolve) => server.listen(0, resolve))
const panelUrl = `http://localhost:${server.address().port}/src/panel/panel.html`

fs.mkdirSync(OUT_DIR, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROMIUM })
const page = await browser.newPage({
  // Ширина — как у боковой панели Chrome.
  viewport: { width: 400, height: 900 },
  colorScheme: "dark",
})

await page.addInitScript(() => {
  // Панель при загрузке спрашивает состояние у service worker, а затем ходит
  // через него в API — отвечаем за оба. Один ответ на все запросы не годится:
  // панель разбирает их по-разному, и на чужой форме падала бы с ошибкой.
  const STATE = {
    settings: { baseUrl: "https://msk1.umnayacrm.ru", logMessages: true },
    configured: true,
    chat: { channel: "telegram", chatId: "@test", title: "Родитель", phone: null },
    tab: { id: 1, url: "https://web.telegram.org/k/", onMessenger: true, contentAlive: true },
  }
  window.chrome = {
    runtime: {
      sendMessage: async (message) => {
        if (message?.type === "get-state") return { ok: true, result: STATE }
        if (message?.type === "api" && message.action === "resolve") {
          // Чат не привязан: карточку в предпросмотре рисуем руками ниже.
          return { ok: true, result: { match: "none", clientId: null, candidates: [], chatId: "@test" } }
        }
        return { ok: true, result: {} }
      },
      onMessage: { addListener: () => {} },
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
  }
})

await page.goto(panelUrl)
await page.waitForTimeout(400)

// Экран №0 — уведомление о сборе данных. Снимаем первым: он длинный, целиком в
// панель не влезает, и проверить надо ровно это — что кнопка «Понятно,
// продолжить» не уехала за нижний край без прокрутки.
await page.evaluate(() => {
  document.getElementById("disclosure").hidden = false
  document.getElementById("setup").hidden = true
  document.getElementById("main").hidden = true
})
await page.waitForTimeout(150)
const disclosureFits = await page.evaluate(() => {
  const button = document.getElementById("disclosure-accept")
  const section = document.getElementById("disclosure")
  return {
    высотаЭкрана: section.scrollHeight,
    высотаОкна: window.innerHeight,
    кнопкаНиз: Math.round(button.getBoundingClientRect().bottom),
    прокруткаЕсть: document.documentElement.scrollHeight > window.innerHeight,
  }
})
console.log("Уведомление о сборе данных:", JSON.stringify(disclosureFits))
await page.screenshot({ path: path.join(OUT_DIR, "disclosure.png"), fullPage: true })

// Рисуем карточку руками: настоящие данные пришли бы из API.
await page.evaluate(() => {
  document.getElementById("disclosure").hidden = true
  document.getElementById("setup").hidden = true
  document.getElementById("main").hidden = false
  document.getElementById("card").hidden = false
  document.getElementById("client-name").textContent = "Иванова Мария"
  document.getElementById("client-meta").textContent = "Активный · Центральный"
  document.getElementById("balance").textContent = "Баланс: 560 ₽"
  document.getElementById("quick").hidden = false
  document.getElementById("quick-buttons").innerHTML =
    '<button class="chip">Расписание</button><button class="chip">Абонемент</button><button class="chip">Баланс</button>'
  document.getElementById("ai-draft").hidden = false
})

const shots = []
await page.screenshot({ path: path.join(OUT_DIR, "card.png") })
shots.push("card.png")

await page.click("#action-task")
await page.waitForTimeout(150)
await page.screenshot({ path: path.join(OUT_DIR, "task.png") })
shots.push("task.png")

const taskLayout = await page.evaluate(() => {
  const save = document.getElementById("action-save").getBoundingClientRect()
  const cancel = document.getElementById("action-cancel").getBoundingClientRect()
  return {
    датаПодставлена: document.getElementById("action-due").value,
    строкаСрокаВидна: document.getElementById("action-due-row").offsetParent !== null,
    подписьКалендаря: document.getElementById("action-due-pick").textContent.trim(),
    ширинаСохранить: Math.round(save.width),
    ширинаОтмена: Math.round(cancel.width),
  }
})

// Календарь свой, поэтому кликается как обычная разметка: открываем, листаем
// на месяц вперёд, выбираем 15-е.
await page.click("#action-due-pick")
await page.waitForTimeout(150)
await page.screenshot({ path: path.join(OUT_DIR, "task-calendar.png") })
shots.push("task-calendar.png")

const calendarOpened = await page.evaluate(() => ({
  календарьВиден: document.getElementById("due-calendar").offsetParent !== null,
  заголовок: document.getElementById("cal-title").textContent,
  днейВСетке: document.querySelectorAll("#cal-grid [data-date]").length,
}))

await page.click("#cal-next")
await page.waitForTimeout(100)
const nextMonthTitle = await page.textContent("#cal-title")
// 15-е число показываемого месяца (не из соседних) — берём кнопку без .other.
await page.click("#cal-grid .cal-day:not(.other):text-is('15')")
await page.waitForTimeout(150)

const afterPick = await page.evaluate(() => ({
  выбраннаяДата: document.getElementById("action-due").value,
  подписьКалендаря: document.getElementById("action-due-pick").textContent.trim(),
  календарьЗакрылся: document.getElementById("due-calendar").offsetParent === null,
  сегодняВыбрано: document.querySelector('[data-due-days="0"]').getAttribute("aria-pressed"),
}))
await page.screenshot({ path: path.join(OUT_DIR, "task-custom-date.png") })
shots.push("task-custom-date.png")

await page.click("#action-note")
await page.waitForTimeout(150)
await page.screenshot({ path: path.join(OUT_DIR, "note.png") })
shots.push("note.png")

const noteLayout = await page.evaluate(() => ({
  формаВидна: document.getElementById("action-form").offsetParent !== null,
  строкаСрокаВидна: document.getElementById("action-due-row").offsetParent !== null,
}))

// Длинная ссылка БЕЗ ПРОБЕЛОВ в переписке. Родитель прислал такую в MAX, и она
// вылезла за карточку, включив горизонтальную прокрутку всей панели.
//
// Проверяем на УЗКОЙ панели: боковая панель Chrome тянется, и при 400px эта
// ссылка помещается — первая версия проверки поэтому молча зеленела. Замер на
// 280px даёт 106px переполнения без фикса и ноль с ним (проверено обоими
// прогонами). Меряем не только документ, но и каждый элемент: длинная строка
// распирает сначала свой блок и только потом страницу.
await page.click("#action-cancel").catch(() => {})
await page.setViewportSize({ width: 280, height: 900 })
await page.evaluate(() => {
  const url = "https://max.ru/u/f9LHodD0cOL2lsi2nx3QLUwgeKrZupsXvX3-actqkac3uRUx-D8-i48"
  document.getElementById("communications").innerHTML =
    "<h3>Переписка и события</h3>" +
    '<div class="msg"><div class="meta">31.08, 12:49 · MAX</div><div>' + url + "</div></div>"
})
await page.waitForTimeout(150)
await page.screenshot({ path: path.join(OUT_DIR, "long-link.png") })
shots.push("long-link.png")
// Меряем не только документ, но и КАЖДЫЙ элемент: длинная строка распирает
// сначала свой блок, и только потом — страницу. Замер по одному
// documentElement.scrollWidth пропускал баг (проверено: без фикса он молчал).
const overflowPx = await page.evaluate(() => {
  const doc = document.documentElement
  let worst = doc.scrollWidth - doc.clientWidth
  let culprit = "документ"
  for (const el of document.querySelectorAll("body *")) {
    const over = el.scrollWidth - el.clientWidth
    if (over > worst) {
      worst = over
      culprit = el.className || el.tagName.toLowerCase()
    }
  }
  return { worst, culprit }
})

await browser.close()
server.close()

console.log("Задача:", JSON.stringify(taskLayout))
console.log("Календарь открыт:", JSON.stringify(calendarOpened), "→", nextMonthTitle)
console.log("После выбора даты:", JSON.stringify(afterPick))
console.log("Комментарий:", JSON.stringify(noteLayout))
console.log(`Скриншоты (${shots.join(", ")}): ${OUT_DIR}`)

if (overflowPx.worst > 1) {
  console.error(
    `РАЗЪЕХАЛОСЬ ВБОК на ${overflowPx.worst}px (элемент: ${overflowPx.culprit}):` +
      " длинная ссылка распирает карточку." +
      " Чинится переносом длинных строк в panel.css (overflow-wrap).",
  )
  process.exitCode = 1
} else {
  console.log("Ничего не разъехалось — длинная ссылка переносится")
}
