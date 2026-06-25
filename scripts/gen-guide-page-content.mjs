// Генерирует app/src/lib/getting-started-guide.ts из docs/getting-started-guide.md.
//
// Контент руководства должен попадать в бандл Next.js (standalone-сборка не
// читает файлы из docs/ во время выполнения), поэтому markdown зашивается в
// TS-модуль строкой. JSON.stringify даёт безопасное экранирование (кавычки,
// переводы строк, обратные слэши, бэктики).
//
// Регенерация после правки руководства:  node scripts/gen-guide-page-content.mjs

import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const SRC = resolve(root, "docs", "getting-started-guide.md")
const OUT = resolve(root, "app", "src", "lib", "getting-started-guide.ts")

const md = readFileSync(SRC, "utf8").replace(/^﻿/, "")

const header =
  "// АВТОГЕНЕРАЦИЯ — не редактируйте вручную.\n" +
  "// Источник: docs/getting-started-guide.md\n" +
  "// Регенерация: node scripts/gen-guide-page-content.mjs\n\n"

const body = `export const gettingStartedGuide = ${JSON.stringify(md)}\n`

writeFileSync(OUT, header + body, "utf8")
console.log(`Записано: ${OUT} (${md.length} символов)`)
