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
  // Панель при загрузке спрашивает состояние у service worker — отвечаем за него.
  window.chrome = {
    runtime: {
      sendMessage: async () => ({
        ok: true,
        result: {
          settings: { baseUrl: "https://msk1.umnayacrm.ru", logMessages: true },
          configured: true,
          chat: { channel: "telegram", chatId: "@test", title: "Родитель", phone: null },
          tab: { id: 1, url: "https://web.telegram.org/k/", onMessenger: true, contentAlive: true },
        },
      }),
      onMessage: { addListener: () => {} },
    },
  }
})

await page.goto(panelUrl)
await page.waitForTimeout(400)

// Рисуем карточку руками: настоящие данные пришли бы из API.
await page.evaluate(() => {
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
    ширинаСохранить: Math.round(save.width),
    ширинаОтмена: Math.round(cancel.width),
  }
})

await page.click("#action-note")
await page.waitForTimeout(150)
await page.screenshot({ path: path.join(OUT_DIR, "note.png") })
shots.push("note.png")

const noteLayout = await page.evaluate(() => ({
  формаВидна: document.getElementById("action-form").offsetParent !== null,
  строкаСрокаВидна: document.getElementById("action-due-row").offsetParent !== null,
}))

await browser.close()
server.close()

console.log("Задача:", JSON.stringify(taskLayout))
console.log("Комментарий:", JSON.stringify(noteLayout))
console.log(`Скриншоты (${shots.join(", ")}): ${OUT_DIR}`)
