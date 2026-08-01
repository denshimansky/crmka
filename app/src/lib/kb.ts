import { cache } from "react"
import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { slugCode } from "@/lib/translit"
import type { AdminPayload } from "@/lib/admin-auth"
import { isValidRutube } from "@/lib/kb-video"
import { kbVariantForSubscriptionType, type KbVariant } from "@/lib/kb-variant"

/**
 * Вкладка базы знаний для организации по её типу абонемента. Читалка вызывает с
 * tenantId из сессии; результат передаётся в getKbNavTree/getKbArticle.
 * Обёрнуто в React cache(): на /knowledge layout и page дёргают её в одном
 * рендере — дедупим один org-запрос (тот же паттерн, что в lib/api-permissions).
 */
export const kbVariantForTenant = cache(async (tenantId: string): Promise<KbVariant> => {
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  return kbVariantForSubscriptionType(org?.subscriptionType ?? null)
})

// Хелперы базы знаний (серверные): слаги разделов/статей и проверка прав.

// Кто из команды может РЕДАКТИРОВАТЬ базу знаний. Читают — все (в приложении).
// support/billing — не контент-роли, поэтому только просмотр в /admin.
const KB_EDITOR_ROLES = new Set(["superadmin", "development"])

export function canEditKb(admin: AdminPayload | null): boolean {
  return !!admin && KB_EDITOR_ROLES.has(admin.role)
}

/** P2002 — нарушение UNIQUE (коллизия слага из-за гонки check-then-insert). */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
}

/**
 * Ретрай на коллизии UNIQUE-слага. uniqueSectionSlug/uniqueArticleSlug выбирают
 * свободный слаг через findFirst, но между чтением и вставкой другой редактор мог
 * занять тот же кандидат. Партиал-UNIQUE в БД (миграция 20260801130000) отклонит
 * вставку (P2002) — повторяем, и слаг-генератор увидит уже занятую строку и
 * возьмёт следующий свободный.
 */
export async function withSlugRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i < attempts - 1 && isUniqueViolation(e)) continue
      throw e
    }
  }
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
  client: Prisma.TransactionClient = db,
): Promise<string> {
  const base = kbSlugify(title)
  let candidate = base
  for (let i = 2; ; i++) {
    const clash = await client.kbSection.findFirst({
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
 * статьи. Показываются только разделы вкладки `variant` (package/calendar).
 * WHERE фильтрует по variant все уровни; для подразделов это безопасно, т.к. они
 * наследуют variant родителя при создании (POST sections / duplicateSectionToVariant).
 * Подразделы, чей родитель снят с публикации/удалён, не попадают (родитель
 * отсутствует среди верхних → потомок отбрасывается).
 * Обёрнуто в React cache(): layout и page строят дерево в одном рендере.
 */
export const getKbNavTree = cache(async (variant: KbVariant): Promise<KbNavSection[]> => {
  const sections = await db.kbSection.findMany({
    where: { deletedAt: null, isPublished: true, variant },
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
})

/**
 * Статья по слагам раздела и статьи (с блоками) + хлебные крошки. `variant`
 * ограничивает выдачу вкладкой организации: прямой переход по URL чужой вкладки
 * даст 404 (раздел не своей вкладки не найдётся). Подраздел хранит variant
 * родителя, поэтому фильтр по разделу корректен и для подразделов.
 */
export async function getKbArticle(
  sectionSlug: string,
  articleSlug: string,
  variant: KbVariant,
) {
  const section = await db.kbSection.findFirst({
    where: {
      slug: sectionSlug,
      deletedAt: null,
      isPublished: true,
      variant,
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
  client: Prisma.TransactionClient = db,
): Promise<string> {
  const base = kbSlugify(title)
  let candidate = base
  for (let i = 2; ; i++) {
    const clash = await client.kbArticle.findFirst({
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

// === Копирование (между вкладками и внутри) ===

/**
 * Копирует статью со всеми блоками в целевой раздел. Заголовок сохраняется,
 * слаг пересчитывается на уникальность в целевом разделе, порядок — в конец.
 * Работает внутри переданной транзакции. Не переносит, а дублирует (оригинал
 * остаётся). variant у копии определяется целевым разделом (у статьи своего нет).
 */
export async function duplicateArticle(
  tx: Prisma.TransactionClient,
  sourceArticleId: string,
  targetSectionId: string,
  createdBy: string | null,
) {
  const src = await tx.kbArticle.findFirst({
    where: { id: sourceArticleId, deletedAt: null },
    include: { blocks: { orderBy: { sortOrder: "asc" } } },
  })
  if (!src) throw new Error("Статья-источник не найдена")

  const target = await tx.kbSection.findFirst({
    where: { id: targetSectionId, deletedAt: null },
    select: { id: true },
  })
  if (!target) throw new Error("Целевой раздел не найден")

  const slug = await uniqueArticleSlug(targetSectionId, src.title, undefined, tx)
  const last = await tx.kbArticle.findFirst({
    where: { sectionId: targetSectionId, deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })

  const created = await tx.kbArticle.create({
    data: {
      sectionId: targetSectionId,
      title: src.title,
      slug,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      isPublished: src.isPublished,
      createdBy,
    },
  })

  if (src.blocks.length > 0) {
    await tx.kbBlock.createMany({
      data: src.blocks.map((b, i) => ({
        articleId: created.id,
        type: b.type,
        text: b.text,
        level: b.level,
        mediaUrl: b.mediaUrl,
        caption: b.caption,
        sortOrder: i,
      })),
    })
  }

  return created
}

/**
 * Копирует верхний раздел целиком (подразделы + все статьи + блоки) в другую
 * вкладку. Нужно, потому что вкладки — независимые деревья: без этого пришлось
 * бы пересоздавать структуру руками. Возвращает созданный верхний раздел.
 */
export async function duplicateSectionToVariant(
  sourceSectionId: string,
  targetVariant: KbVariant,
  createdBy: string | null,
) {
  return db.$transaction(
    async (tx) => {
      const top = await tx.kbSection.findFirst({
        where: { id: sourceSectionId, deletedAt: null, parentId: null },
      })
      if (!top) throw new Error("Раздел не найден или не является верхним")
      if (top.variant === targetVariant) {
        throw new Error("Раздел уже в этой вкладке")
      }

      const topSlug = await uniqueSectionSlug(null, top.title, undefined, tx)
      const lastTop = await tx.kbSection.findFirst({
        where: { parentId: null, deletedAt: null },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      })
      const newTop = await tx.kbSection.create({
        data: {
          parentId: null,
          variant: targetVariant,
          title: top.title,
          slug: topSlug,
          icon: top.icon,
          sortOrder: (lastTop?.sortOrder ?? -1) + 1,
          isPublished: top.isPublished,
        },
      })

      // Статьи самого верхнего раздела.
      const topArticles = await tx.kbArticle.findMany({
        where: { sectionId: top.id, deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true },
      })
      for (const a of topArticles) {
        await duplicateArticle(tx, a.id, newTop.id, createdBy)
      }

      // Подразделы + их статьи.
      const subs = await tx.kbSection.findMany({
        where: { parentId: top.id, deletedAt: null },
        orderBy: { sortOrder: "asc" },
      })
      for (const sub of subs) {
        const subSlug = await uniqueSectionSlug(newTop.id, sub.title, undefined, tx)
        const newSub = await tx.kbSection.create({
          data: {
            parentId: newTop.id,
            variant: targetVariant,
            title: sub.title,
            slug: subSlug,
            icon: sub.icon,
            sortOrder: sub.sortOrder,
            isPublished: sub.isPublished,
          },
        })
        const subArticles = await tx.kbArticle.findMany({
          where: { sectionId: sub.id, deletedAt: null },
          orderBy: { sortOrder: "asc" },
          select: { id: true },
        })
        for (const a of subArticles) {
          await duplicateArticle(tx, a.id, newSub.id, createdBy)
        }
      }

      return newTop
    },
    { timeout: 30000 },
  )
}
