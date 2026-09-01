/**
 * Генерация PNG-иконок расширения из SVG.
 *
 * ЗАЧЕМ СКРИПТ, А НЕ ГОТОВЫЕ PNG В РЕПОЗИТОРИИ. PNG в git — двоичный файл,
 * который нельзя прочитать в дифе: правку знака никто не заметит на ревью, а
 * перегенерировать «как было» будет нечем. Исходник тут — SVG (icons/source/),
 * PNG получаются из него одной командой и лежат рядом как артефакт сборки.
 * Коммитим и то и другое: браузер SVG в manifest.icons не принимает.
 *
 * ПОЧЕМУ PLAYWRIGHT, А НЕ sharp/resvg. На этой машине нет ни того, ни другого, и
 * ставить зависимость ради четырёх картинок незачем: Playwright уже установлен в
 * app/ (им снимаются скриншоты панели, tools/panel-preview.mjs), а рендер SVG →
 * PNG — это ровно скриншот страницы с прозрачным фоном.
 *
 * ЗАПУСК (из папки app — там лежит playwright):
 *   cd app && node ../extension/tools/make-icons.mjs
 *
 * Браузер берётся системный; путь переопределяется переменной CHROMIUM_PATH.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ICONS = resolve(HERE, "..", "icons")
const SOURCE = resolve(ICONS, "source")

// Playwright лежит в зависимостях ПРИЛОЖЕНИЯ, а не расширения (у расширения
// сборки нет вовсе). Обычный import его отсюда не найдёт — резолвим от
// app/package.json, тем же способом, что и tools/panel-preview.mjs.
const require = createRequire(join(HERE, "..", "..", "app", "package.json"))
const { chromium } = require("@playwright/test")

/**
 * Какой исходник в каком размере рендерим.
 *
 * 16 и 32 — из упрощённого знака (в тулбаре две искры сливаются в пятно),
 * 48 и 128 — из полного. Набор размеров — требование Chrome:
 *   16  — фавиконка страниц расширения и контекстное меню,
 *   32  — Windows-интерфейсы, требуют кратности,
 *   48  — страница chrome://extensions,
 *   128 — установка и карточка в Chrome Web Store (обязателен для публикации).
 */
const TARGETS = [
  { size: 16, source: "icon-small.svg" },
  { size: 32, source: "icon-small.svg" },
  { size: 48, source: "icon.svg" },
  { size: 128, source: "icon.svg" },
]

/** Прозрачный фон обязателен: иначе вокруг знака будет белая рамка на тёмной теме. */
const PAGE = (svg, size) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block;width:${size}px;height:${size}px}
</style>${svg}`

// Тот же браузер, что и у panel-preview.mjs: playwright-браузеры на этой машине
// не скачаны (CDN недоступен), поэтому берётся установленный вручную Chromium.
const CHROMIUM =
  process.env.CHROMIUM_PATH || "C:/Users/Cyberjinn/AppData/Local/Chromium/Application/chrome.exe"

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const page = await browser.newPage({ viewport: { width: 256, height: 256 } })

await mkdir(ICONS, { recursive: true })

for (const { size, source } of TARGETS) {
  const svg = await readFile(resolve(SOURCE, source), "utf8")
  await page.setContent(PAGE(svg, size))
  const node = await page.$("svg")
  if (!node) throw new Error(`не нашёлся <svg> в ${source}`)
  const png = await node.screenshot({ omitBackground: true, type: "png" })
  const out = resolve(ICONS, `icon-${size}.png`)
  await writeFile(out, png)
  console.log(`icon-${size}.png — ${png.length} байт (из ${source})`)
}

await browser.close()
console.log("Готово. Иконки лежат в extension/icons/")
