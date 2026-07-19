/**
 * Backfill Organization.portalSlug (ЛК родителя v2, deploy 2026-07-19).
 *
 * Слаг — часть публичной ссылки кабинета родителей /p/<slug>. Новым
 * организациям он генерируется при создании; существующим — этим скриптом
 * (страховка: API выдачи учётки генерирует on-demand, если слаг пуст).
 *
 * Запуск (на сервере, в контейнере app):
 *     docker compose exec app npx tsx prisma/scripts/backfill-portal-slugs.ts
 *
 * Идемпотентный: организации с уже заполненным слагом пропускаются.
 *
 * НЕ запускается автоматически миграцией Prisma.
 */
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

// Inline-копия транслита из src/lib/translit.ts + slugFromName из
// src/lib/portal-slug.ts — скрипт запускается в контейнере app, где src/lib
// не присутствует (Next.js standalone ships only compiled output).
const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
}

function slugFromName(name: string): string {
  let base = name
    .toLowerCase()
    .split("")
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  if (base.length < 3) base = base ? `centr-${base}` : "centr"
  return base.slice(0, 40).replace(/-+$/g, "")
}

async function main() {
  const orgs = await db.organization.findMany({
    where: { portalSlug: null },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  })
  console.log(`Организаций без слага: ${orgs.length}`)

  for (const org of orgs) {
    const base = slugFromName(org.name)
    let candidate = base
    for (let i = 2; ; i++) {
      const exists = await db.organization.findUnique({
        where: { portalSlug: candidate },
        select: { id: true },
      })
      if (!exists) break
      const suffix = `-${i}`
      candidate = base.slice(0, 40 - suffix.length) + suffix
    }
    await db.organization.update({ where: { id: org.id }, data: { portalSlug: candidate } })
    console.log(`  ${org.name} → /p/${candidate}`)
  }

  console.log("Готово.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
