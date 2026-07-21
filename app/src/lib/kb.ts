import { db } from "@/lib/db"
import { slugCode } from "@/lib/translit"
import type { AdminPayload } from "@/lib/admin-auth"
import { isValidRutube } from "@/lib/kb-video"

// Хелперы базы знаний (серверные): слаги разделов/статей и проверка прав.

// Кто из команды может РЕДАКТИРОВАТЬ базу знаний. Читают — все (в приложении).
// support/billing — не контент-роли, поэтому только просмотр в /admin.
const KB_EDITOR_ROLES = new Set(["superadmin", "development"])

export function canEditKb(admin: AdminPayload | null): boolean {
  return !!admin && KB_EDITOR_ROLES.has(admin.role)
}

/** URL-слаг из заголовка: [a-z0-9-], без краевых дефисов. */
export function kbSlugify(title: string, maxLen = 60): string {
  const base = slugCode(title, maxLen)
    .replace(/_/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  return base || "razdel"
}

/**
 * Уникальный слаг раздела ГЛОБАЛЬНО (среди всех разделов, не только соседей) —
 * чтобы URL читалки /knowledge/<sectionSlug>/<articleSlug> резолвился
 * однозначно. parentId в подписи оставлен для симметрии со статьями.
 * excludeId — при переименовании существующего.
 */
export async function uniqueSectionSlug(
  _parentId: string | null,
  title: string,
  excludeId?: string,
): Promise<string> {
  const base = kbSlugify(title)
  let candidate = base
  for (let i = 2; ; i++) {
    const clash = await db.kbSection.findFirst({
      where: {
        slug: candidate,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    })
    if (!clash) return candidate
    candidate = `${base}-${i}`
  }
}

// === Чтение для читалки (только опубликованное, не удалённое) ===

export interface KbNavArticle {
  title: string
  slug: string
}
export interface KbNavSection {
  id: string
  title: string
  slug: string
  icon: string | null
  articles: KbNavArticle[]
  children: KbNavSection[]
}

/**
 * Дерево навигации для читалки: верхние разделы → подразделы, у каждого — свои
 * статьи. Подразделы, чей родитель снят с публикации/удалён, не попадают
 * (родитель отсутствует среди верхних → потомок отбрасывается).
 */
export async function getKbNavTree(): Promise<KbNavSection[]> {
  const sections = await db.kbSection.findMany({
    where: { deletedAt: null, isPublished: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      parentId: true,
      title: true,
      slug: true,
      icon: true,
      articles: {
        where: { deletedAt: null, isPublished: true },
        orderBy: { sortOrder: "asc" },
        select: { title: true, slug: true },
      },
    },
  })

  const childrenByParent = new Map<string, typeof sections>()
  for (const s of sections) {
    if (!s.parentId) continue
    const arr = childrenByParent.get(s.parentId) ?? []
    arr.push(s)
    childrenByParent.set(s.parentId, arr)
  }

  const toNode = (s: (typeof sections)[number]): KbNavSection => ({
    id: s.id,
    title: s.title,
    slug: s.slug,
    icon: s.icon,
    articles: s.articles,
    children: (childrenByParent.get(s.id) ?? []).map(toNode),
  })

  return sections.filter((s) => !s.parentId).map(toNode)
}

/** Статья по слагам раздела и статьи (с блоками) + хлебные крошки. */
export async function getKbArticle(sectionSlug: string, articleSlug: string) {
  const section = await db.kbSection.findFirst({
    where: {
      slug: sectionSlug,
      deletedAt: null,
      isPublished: true,
      OR: [{ parentId: null }, { parent: { deletedAt: null, isPublished: true } }],
    },
    include: { parent: { select: { title: true, slug: true } } },
  })
  if (!section) return null

  const article = await db.kbArticle.findFirst({
    where: { sectionId: section.id, slug: articleSlug, deletedAt: null, isPublished: true },
    include: { blocks: { orderBy: { sortOrder: "asc" } } },
  })
  if (!article) return null

  return { article, section, parent: section.parent }
}

/** Ссылка на первую доступную статью (для лендинга /knowledge). */
export function firstArticleHref(tree: KbNavSection[]): string | null {
  for (const top of tree) {
    if (top.articles[0]) return `/knowledge/${top.slug}/${top.articles[0].slug}`
    for (const child of top.children) {
      if (child.articles[0]) return `/knowledge/${child.slug}/${child.articles[0].slug}`
    }
  }
  return null
}

export type KbBlockType = "heading" | "text" | "image" | "video"

export interface KbBlockInput {
  text?: string | null
  level?: number | null
  mediaUrl?: string | null
  caption?: string | null
}

export interface KbBlockFields {
  text: string | null
  level: number | null
  mediaUrl: string | null
  caption: string | null
}

/**
 * Проверяет и нормализует поля блока по его типу. Возвращает готовый набор
 * колонок (лишние поля обнуляются) либо текст ошибки.
 */
export function buildBlockFields(
  type: KbBlockType,
  input: KbBlockInput,
): { ok: true; data: KbBlockFields } | { ok: false; error: string } {
  const text = typeof input.text === "string" ? input.text.trim() : ""
  const mediaUrl = typeof input.mediaUrl === "string" ? input.mediaUrl.trim() : ""
  const caption = typeof input.caption === "string" && input.caption.trim() ? input.caption.trim() : null

  switch (type) {
    case "heading": {
      if (!text) return { ok: false, error: "Текст заголовка обязателен" }
      const level = input.level === 3 ? 3 : 2
      return { ok: true, data: { text, level, mediaUrl: null, caption: null } }
    }
    case "text": {
      if (!text) return { ok: false, error: "Текст блока обязателен" }
      return { ok: true, data: { text, level: null, mediaUrl: null, caption: null } }
    }
    case "image": {
      if (!mediaUrl) return { ok: false, error: "Загрузите изображение" }
      return { ok: true, data: { text: null, level: null, mediaUrl, caption } }
    }
    case "video": {
      if (!mediaUrl) return { ok: false, error: "Укажите ссылку на видео RuTube" }
      if (!isValidRutube(mediaUrl)) return { ok: false, error: "Не удалось распознать ссылку RuTube" }
      return { ok: true, data: { text: null, level: null, mediaUrl, caption } }
    }
    default:
      return { ok: false, error: "Неизвестный тип блока" }
  }
}

/** Уникальный слаг статьи среди статей раздела. */
export async function uniqueArticleSlug(
  sectionId: string,
  title: string,
  excludeId?: string,
): Promise<string> {
  const base = kbSlugify(title)
  let candidate = base
  for (let i = 2; ; i++) {
    const clash = await db.kbArticle.findFirst({
      where: {
        sectionId,
        slug: candidate,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    })
    if (!clash) return candidate
    candidate = `${base}-${i}`
  }
}
