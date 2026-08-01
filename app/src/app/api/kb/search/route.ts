import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { kbVariantForTenant } from "@/lib/kb"

// GET /api/kb/search?q=... — поиск по опубликованным статьям базы знаний
// (заголовок + текст блоков). Доступно любому залогиненному пользователю.
// Ищем только по вкладке, соответствующей типу абонемента организации.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const q = (req.nextUrl.searchParams.get("q") || "").trim()
  if (q.length < 2) return NextResponse.json([])

  const variant = await kbVariantForTenant(session.user.tenantId)

  // Раздел статьи виден, только если он своей вкладки и он и его родитель
  // (если есть) опубликованы.
  const visibleSection = {
    deletedAt: null,
    isPublished: true,
    variant,
    OR: [{ parentId: null }, { parent: { deletedAt: null, isPublished: true } }],
  }

  const articles = await db.kbArticle.findMany({
    where: {
      deletedAt: null,
      isPublished: true,
      section: visibleSection,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        // Ищем по тексту любого блока: text-абзацы И heading-заголовки (оба хранят
        // текст в поле text). У image/video text=null — под contains не попадут.
        { blocks: { some: { text: { contains: q, mode: "insensitive" } } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      slug: true,
      section: { select: { slug: true, title: true } },
      blocks: {
        where: { text: { contains: q, mode: "insensitive" } },
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { text: true },
      },
    },
  })

  const results = articles.map((a) => {
    const snippetSrc = a.blocks[0]?.text || ""
    const snippet = snippetSrc.length > 160 ? snippetSrc.slice(0, 160) + "…" : snippetSrc
    return {
      articleSlug: a.slug,
      sectionSlug: a.section.slug,
      sectionTitle: a.section.title,
      title: a.title,
      snippet,
      href: `/knowledge/${a.section.slug}/${a.slug}`,
    }
  })

  return NextResponse.json(results)
}
