/**
 * Генерация PNG-иконок расширения и картинок для листинга Chrome Web Store.
 *
 * ЗАЧЕМ СКРИПТ, А НЕ ГОТОВЫЕ PNG В РЕПОЗИТОРИИ. PNG в git — двоичный файл,
 * который нельзя прочитать в дифе: правку знака никто не заметит на ревью, а
 * перегенерировать «как было» будет нечем. Исходник тут — SVG (icons/source/),
 * PNG получаются из него одной командой. Коммитим и то и другое: браузер SVG в
 * manifest.icons не принимает.
 *
 * ЧЕМ РЕНДЕРИМ. sharp (libvips) — он уже стоит в app/node_modules, приезжает
 * туда вместе с Next.js (оптимизация картинок) и умеет SVG на вход. Отдельной
 * зависимости не заводим. Ограничение честное: sharp здесь ТРАНЗИТИВНЫЙ, и
 * теоретически может уехать при мажорном обновлении Next — тогда лечится
 * `npm i -D sharp` в app/, других правок скрипт не потребует.
 *
 * Раньше здесь был Playwright со скриншотом страницы. Отказались: он тянет
 * захардкоженный путь к вручную поставленному Chromium, которого на второй
 * машине нет, и падал бы там ровно в тот момент, когда иконки надо
 * перегенерировать.
 *
 * ЗАПУСК (из папки app — там лежит sharp):
 *   cd app && node ../extension/tools/make-icons.mjs
 *
 * ЧТО ПОЛУЧАЕТСЯ:
 *   extension/icons/icon-{16,32,48,128}.png — то, что объявлено в манифесте и
 *     едет в архив расширения;
 *   extension/icons/store/icon-128-store.png — ОТДЕЛЬНАЯ иконка магазина:
 *     рисунок 96×96 внутри прозрачного поля 128×128. Грузится в дашборде
 *     руками, из манифеста не берётся. Требование Google: без полей иконка в
 *     каталоге обрезается по краям;
 *   extension/icons/store/promo-440x280.png — малая промо-плитка листинга.
 *     Прозрачности в ней быть не должно, поэтому фон рисуем явно.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ICONS = resolve(HERE, "..", "icons")
const SOURCE = resolve(ICONS, "source")
const STORE = resolve(ICONS, "store")

// sharp лежит в зависимостях ПРИЛОЖЕНИЯ, а не расширения (у расширения сборки
// нет вовсе). Обычный import его отсюда не найдёт — резолвим от app/package.json,
// тем же способом, что и tools/panel-preview.mjs.
const require = createRequire(join(HERE, "..", "..", "app", "package.json"))
const sharp = require("sharp")

/**
 * Какой исходник в каком размере рендерим.
 *
 * 16 и 32 — из упрощённого знака (в тулбаре две искры сливаются в пятно),
 * 48 и 128 — из полного. Набор размеров — требование Chrome:
 *   16  — фавиконка страниц расширения и контекстное меню,
 *   32  — интерфейсы Windows, требуют кратности,
 *   48  — страница chrome://extensions,
 *   128 — установка и карточка в Chrome Web Store.
 */
const TARGETS = [
  { size: 16, source: "icon-small.svg" },
  { size: 32, source: "icon-small.svg" },
  { size: 48, source: "icon.svg" },
  { size: 128, source: "icon.svg" },
]

/** Фон промо-плитки — тот же чёрный, что у знака: плитка без фона выглядит битой. */
const BRAND_BG = { r: 10, g: 10, b: 10, alpha: 1 }

/**
 * Растрируем SVG в нужном размере.
 *
 * `density` важен: sharp растрирует SVG исходя из плотности, а не из
 * запрошенного размера, и на маленьких размерах без её подъёма получаются
 * размытые края. 72 dpi — база, поэтому масштабируем её пропорционально.
 */
async function render(svg, size) {
  const density = Math.max(72, Math.round((72 * size) / 32))
  return sharp(Buffer.from(svg), { density })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

await mkdir(ICONS, { recursive: true })
await mkdir(STORE, { recursive: true })

for (const { size, source } of TARGETS) {
  const svg = await readFile(resolve(SOURCE, source), "utf8")
  const png = await render(svg, size)
  await writeFile(resolve(ICONS, `icon-${size}.png`), png)
  console.log(`icons/icon-${size}.png — ${png.length} Б (из ${source})`)
}

// ── Материалы листинга ──────────────────────────────────────────────────────

// Иконка магазина: рисунок 96×96 в прозрачном поле 128×128 (по 16 px с каждой
// стороны). Это требование Google к КАРТОЧКЕ, а не к манифесту, и файл там
// отдельный: без полей каталог обрезает знак по краям.
{
  const svg = await readFile(resolve(SOURCE, "icon.svg"), "utf8")
  const inner = await render(svg, 96)
  const png = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: inner, top: 16, left: 16 }])
    .png()
    .toBuffer()
  await writeFile(resolve(STORE, "icon-128-store.png"), png)
  console.log(`icons/store/icon-128-store.png — ${png.length} Б (рисунок 96×96 + поля 16 px)`)
}

// Малая промо-плитка 440×280: знак слева, название и подпись справа. Один знак
// без слов в каталоге не читается — плитка стоит в ряду чужих, и по ней человек
// должен понять, чей это продукт.
//
// Текст рисуем ГЕОМЕТРИЕЙ (SVG-контуры вместо <text>), а не шрифтом: librsvg
// внутри sharp берёт шрифты из fontconfig, которого на Windows фактически нет —
// подпись либо не отрисуется вовсе, либо уедет другим шрифтом, и мы узнаем об
// этом уже из карточки в сторе. Здесь надпись собрана из готового SVG-исходника.
{
  const promoSvg = await readFile(resolve(SOURCE, "promo.svg"), "utf8")
  const png = await sharp(Buffer.from(promoSvg), { density: 144 })
    .resize(440, 280, { fit: "fill", background: BRAND_BG })
    .flatten({ background: BRAND_BG })
    .png()
    .toBuffer()
  await writeFile(resolve(STORE, "promo-440x280.png"), png)
  console.log(`icons/store/promo-440x280.png — ${png.length} Б`)
}

console.log(
  "\nГотово.\n" +
    "  icons/*.png        — едут в архив расширения (объявлены в манифесте);\n" +
    "  icons/store/*.png  — грузятся руками в карточку Chrome Web Store.\n" +
    "Скриншоты листинга (1280×800) отсюда НЕ берутся: на них должна быть панель\n" +
    "поверх живого мессенджера, их снимают руками.",
)
