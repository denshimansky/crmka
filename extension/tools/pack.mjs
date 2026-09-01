/**
 * Упаковка расширения в ZIP для загрузки в Chrome Web Store.
 *
 * ЗАЧЕМ СВОЙ УПАКОВЩИК, А НЕ `zip` ИЛИ Compress-Archive.
 *   • утилиты `zip` в Git Bash на этой машине нет вовсе;
 *   • `Compress-Archive` (PowerShell 5.1) кладёт в архив ЛИШНИЙ верхний уровень,
 *     если передать папку, и известен тем, что пишет разделителем «\» —
 *     а Chrome Web Store ждёт `manifest.json` в КОРНЕ архива и пути через «/».
 *     Ошибка проявится только при загрузке, сообщением «Manifest file is
 *     missing or unreadable», и разбираться в ней придётся вслепую;
 *   • ставить archiver/adm-zip ради одного архива противоречит устройству
 *     расширения (сборки нет намеренно, см. README).
 * Формат ZIP простой, а zlib есть в Node из коробки — пишем сами, 150 строк.
 *
 * АРХИВ ДЕТЕРМИНИРОВАННЫЙ: время файлов фиксировано. Один и тот же исходный код
 * даёт побайтово одинаковый zip — можно сверить, что в стор ушло ровно то, что
 * лежит в git, и что повторная упаковка ничего не поменяла.
 *
 * ЧТО ВНУТРИ. Только то, что нужно браузеру в рантайме. Инструменты разработки
 * (tools/), тесты, package.json, jsconfig и документация в архив НЕ идут: они
 * увеличивают поверхность ревью и заставляют объяснять ревьюеру лишние файлы.
 *
 * ПРОВЕРКИ ПЕРЕД УПАКОВКОЙ (главная ценность скрипта, а не сам zip). Скрипт
 * читает манифест и убеждается, что КАЖДЫЙ упомянутый в нём файл действительно
 * попал в архив: service worker, все content scripts, панель, иконки,
 * web_accessible_resources. Забытый файл иначе обнаружился бы уже у сотрудника —
 * молча сломанным каналом.
 *
 * ЗАПУСК:
 *   node extension/tools/pack.mjs            — собрать extension/dist/crmka-extension-<версия>.zip
 *   node extension/tools/pack.mjs --list     — показать состав, не создавая архив
 */

import { createHash } from "node:crypto"
import { deflateRawSync } from "node:zlib"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DIST = join(ROOT, "dist")

/**
 * Что НЕ кладём в архив. Список «чёрный», а не «белый», сознательно: забытый в
 * белом списке новый файл — это молча сломанное расширение у сотрудника, а
 * забытый в чёрном — лишний килобайт в архиве. Цена ошибки несимметрична.
 */
const EXCLUDE_DIRS = new Set(["tools", "dist", "node_modules", "__tests__", ".git"])

/**
 * Плюс всё, что перечислено в extension/.gitignore.
 *
 * Чёрный список руками уже подвёл: 01.09.2026 в архив уехала папka shots/ со
 * скриншотами для листинга — 1.2 МБ вместо 161 КБ, и картинки с карточкой
 * клиента поехали бы всем пользователям и ревьюеру. .gitignore — это и есть
 * готовый ответ на вопрос «что не относится к продукту»; берём его, чтобы
 * следующая рабочая папка не повторила историю.
 */
for (const line of readFileSync(join(ROOT, ".gitignore"), "utf8").split(/\r?\n/)) {
  const entry = line.trim()
  if (!entry || entry.startsWith("#") || entry.startsWith("!")) continue
  const name = entry.replace(/\/+$/, "")
  // Только простые имена папок: шаблоны со звёздочками и вложенными путями
  // .gitignore умеет, а этот цикл — нет, и притворяться не будет.
  if (!name.includes("/") && !name.includes("*")) EXCLUDE_DIRS.add(name)
}
const EXCLUDE_FILES = new Set([
  "package.json",
  "package-lock.json",
  "jsconfig.json",
  "README.md",
  "TESTING.md",
  ".gitignore",
  "key.pem", // приватный ключ подписи CRX: в архив попасть не должен НИКОГДА
])
/** Исходники иконок: в рантайме браузеру нужны только PNG. */
const EXCLUDE_PATHS = new Set(["icons/source"])

/** @returns {string[]} пути относительно корня расширения, через «/» */
function collectFiles(dir = ROOT, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = relative(ROOT, full).split(sep).join("/")
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name) || EXCLUDE_PATHS.has(rel)) continue
      collectFiles(full, acc)
      continue
    }
    if (EXCLUDE_FILES.has(entry.name)) continue
    acc.push(rel)
  }
  return acc.sort()
}

/**
 * Файлы, на которые ссылается манифест. Проверяем их наличие в архиве — иначе
 * расширение установится и молча не заработает.
 * @param {any} manifest
 * @returns {string[]}
 */
function manifestReferences(manifest) {
  const out = []
  const sw = manifest.background?.service_worker
  if (sw) out.push(sw)
  const panel = manifest.side_panel?.default_path
  if (panel) out.push(panel)
  for (const entry of manifest.content_scripts ?? []) out.push(...(entry.js ?? []), ...(entry.css ?? []))
  for (const entry of manifest.web_accessible_resources ?? []) out.push(...(entry.resources ?? []))
  for (const path of Object.values(manifest.icons ?? {})) out.push(String(path))
  const actionIcon = manifest.action?.default_icon
  if (typeof actionIcon === "string") out.push(actionIcon)
  else for (const path of Object.values(actionIcon ?? {})) out.push(String(path))
  if (manifest.action?.default_popup) out.push(manifest.action.default_popup)
  return [...new Set(out)]
}

// ── Минимальный писатель ZIP ────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * Время файла в архиве фиксировано — ради воспроизводимости (см. шапку).
 * 2020-01-01 00:00 в формате DOS: дата (год-1980)<<9 | месяц<<5 | день.
 */
const DOS_TIME = 0
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1

function zip(entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8")
    const compressed = deflateRawSync(data, { level: 9 })
    // Если сжатие не помогло (мелкие PNG уже сжаты), кладём как есть: так
    // архив меньше и распаковка быстрее.
    const useStore = compressed.length >= data.length
    const payload = useStore ? data : compressed
    const method = useStore ? 0 : 8
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // версия, необходимая для распаковки
    local.writeUInt16LE(0x0800, 6) // флаг «имена в UTF-8»
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, nameBuf, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // кем создан
    central.writeUInt16LE(20, 6) // версия для распаковки
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(0, 38) // внешние атрибуты: 0 — обычный файл
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + payload.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuf, eocd])
}

// ── Сборка ──────────────────────────────────────────────────────────────────

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"))
const files = collectFiles()
const listOnly = process.argv.includes("--list")

const missing = manifestReferences(manifest).filter((path) => !files.includes(path))
if (missing.length) {
  console.error("В архив не попали файлы, на которые ссылается манифест:")
  for (const path of missing) console.error(`  • ${path}`)
  console.error("Проверьте списки исключений в tools/pack.mjs или путь в манифесте.")
  process.exit(1)
}

const entries = files.map((name) => ({ name, data: readFileSync(join(ROOT, name)) }))
const total = entries.reduce((sum, e) => sum + e.data.length, 0)

console.log(`Версия из манифеста: ${manifest.version}`)
console.log(`Файлов: ${entries.length}, исходный объём: ${(total / 1024).toFixed(1)} КБ`)
for (const { name, data } of entries) console.log(`  ${name} — ${data.length} Б`)

if (listOnly) {
  console.log("\n--list: архив не создавался.")
  process.exit(0)
}

const archive = zip(entries)
mkdirSync(DIST, { recursive: true })
const out = join(DIST, `crmka-extension-${manifest.version}.zip`)
writeFileSync(out, archive)

console.log(`\nГотово: ${out}`)
console.log(`Размер: ${(archive.length / 1024).toFixed(1)} КБ`)
console.log(`sha256: ${createHash("sha256").update(archive).digest("hex")}`)
console.log(
  "\nДальше: Chrome Web Store → Developer Dashboard → загрузить этот zip.\n" +
    "Перед загрузкой убедиться, что версия в manifest.json больше опубликованной —\n" +
    "стор отвергает повторную загрузку той же версии.",
)
