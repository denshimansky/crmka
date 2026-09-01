/**
 * Приведение скриншотов листинга к точным 1280×800.
 *
 * ЗАЧЕМ. Chrome Web Store принимает скриншоты ровно 1280×800 (или 640×400) и
 * отклоняет всё остальное — а окно браузера такого размера руками не выставить.
 * Снимать поэтому надо как удобно, а размер получать здесь.
 *
 * ЧТО ДЕЛАЕТ. Вписывает кадр в 1280×800 БЕЗ полей: масштабирует по большей
 * стороне и обрезает лишнее по центру (fit: "cover"). Поля («письмо в конверте»,
 * белые или чёрные полосы по краям) — отдельная причина отказа, поэтому режем, а
 * не подкладываем фон.
 *
 * ⚠️ Обрезка не бесплатна: у кадра с пропорциями, далёкими от 16:10, срежется
 * заметная часть. Снимайте окно примерно в этих пропорциях — тогда обрезка
 * заберёт только края. Что именно срезано, скрипт печатает.
 *
 * ЗАПУСК (из папки app — там лежит sharp, как и у make-icons.mjs):
 *   cd app && node ../extension/tools/shot-1280.mjs ../путь/к/кадру.png [ещё...]
 *
 * Результат — рядом с исходником, с суффиксом «-1280x800». Исходники скрипт не
 * трогает: пересняли — прогнали заново.
 *
 * ⚠️ ПДн. Скриншоты уезжают в публичный магазин. Живая переписка с родителями —
 * имена, телефоны, суммы — это раскрытие персональных данных третьих лиц.
 * Снимать на демо-организации; скрипт этого за вас не проверит.
 */

import { createRequire } from "node:module"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

// sharp — транзитивная зависимость приложения (приезжает с Next.js), своей
// сборки у расширения нет. Резолвим от app/package.json, как в make-icons.mjs.
const require = createRequire(join(HERE, "..", "..", "app", "package.json"))
const sharp = require("sharp")

const WIDTH = 1280
const HEIGHT = 800

const inputs = process.argv.slice(2)

if (inputs.length === 0) {
  console.error(
    "Укажите файлы:\n" +
      "  cd app && node ../extension/tools/shot-1280.mjs ../shots/vk.png ../shots/tg.png",
  )
  process.exit(1)
}

for (const input of inputs) {
  const source = resolve(process.cwd(), input)
  const ext = extname(source) || ".png"
  const target = source.slice(0, source.length - ext.length) + `-${WIDTH}x${HEIGHT}.png`

  const image = sharp(source)
  const { width = 0, height = 0 } = await image.metadata()

  await image
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
    // Прозрачность в скриншоте листинга недопустима: магазин подложит своё, и
    // кадр «поедет». Кладём белый фон под альфу, если она есть.
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toFile(target)

  // Насколько кадр отличался от 16:10 — столько и срезано по одной из сторон.
  const scale = Math.max(WIDTH / width, HEIGHT / height)
  const cropX = Math.round(width - WIDTH / scale)
  const cropY = Math.round(height - HEIGHT / scale)
  const loss = cropX > 0 ? `срезано по ширине ${cropX} px` : cropY > 0 ? `срезано по высоте ${cropY} px` : "без обрезки"

  console.log(`${input}: ${width}×${height} → ${WIDTH}×${HEIGHT} (${loss})`)
  console.log(`  → ${target}`)
}
