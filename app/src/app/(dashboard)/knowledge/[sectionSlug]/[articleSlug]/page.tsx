import { notFound } from "next/navigation"
import { getKbArticle } from "@/lib/kb"
import { KbArticleBody } from "@/components/kb/kb-article"
import { PageHelp } from "@/components/page-help"

export default async function KbArticlePage({
  params,
}: {
  params: Promise<{ sectionSlug: string; articleSlug: string }>
}) {
  const { sectionSlug, articleSlug } = await params
  const data = await getKbArticle(sectionSlug, articleSlug)
  if (!data) notFound()

  const { article, section, parent } = data

  return (
    <article>
      <div className="mb-1 text-xs text-muted-foreground">
        {parent && (
          <>
            <span>{parent.title}</span>
            <span className="mx-1">/</span>
          </>
        )}
        <span>{section.title}</span>
      </div>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-2xl font-bold">{article.title}</h1>
        <PageHelp pageKey="knowledge" />
      </div>
      <KbArticleBody blocks={article.blocks} />
    </article>
  )
}
