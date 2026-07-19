import { db } from "@/lib/db"
import { slugCode } from "@/lib/translit"

// Слаг портала родителей: часть ссылки /p/<slug>, [a-z0-9-]{3,40},
// глобально уникален (organizations.portal_slug @unique).

export const PORTAL_SLUG_REGEX = /^[a-z0-9-]{3,40}$/

/** Кандидат-слаг из названия организации (без проверки уникальности). */
export function slugFromName(name: string): string {
  let base = slugCode(name, 40)
    .replace(/_/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (base.length < 3) base = base ? `centr-${base}` : "centr"
  return base.slice(0, 40).replace(/-+$/g, "")
}

/** Уникальный слаг: базовый вариант, при коллизии — суффиксы -2, -3, … */
export async function generateUniquePortalSlug(name: string): Promise<string> {
  const base = slugFromName(name)
  let candidate = base
  for (let i = 2; ; i++) {
    const exists = await db.organization.findUnique({
      where: { portalSlug: candidate },
      select: { id: true },
    })
    if (!exists) return candidate
    const suffix = `-${i}`
    candidate = base.slice(0, 40 - suffix.length) + suffix
  }
}

/**
 * Слаг организации: вернуть существующий или сгенерировать и сохранить
 * (страховка on-demand до/вместо backfill-скрипта).
 */
export async function ensurePortalSlug(orgId: string): Promise<string> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { portalSlug: true, name: true },
  })
  if (!org) throw new Error("Организация не найдена")
  if (org.portalSlug) return org.portalSlug

  const slug = await generateUniquePortalSlug(org.name)
  try {
    await db.organization.update({ where: { id: orgId }, data: { portalSlug: slug } })
    return slug
  } catch {
    // Гонка на unique-конкурентной генерации: пробуем ещё раз с новым суффиксом
    const retry = await generateUniquePortalSlug(org.name)
    await db.organization.update({ where: { id: orgId }, data: { portalSlug: retry } })
    return retry
  }
}
