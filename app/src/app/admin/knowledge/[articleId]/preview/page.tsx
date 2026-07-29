"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { KbArticleBody, type KbArticleBlock } from "@/components/kb/kb-article"

// Предпросмотр статьи базы знаний для бэк-офиса. В отличие от читалки
// /knowledge/<section>/<article> (только опубликованное + сессия арендатора),
// тянет статью через admin-API, который отдаёт и черновики — чтобы редактор
// мог посмотреть материал ДО публикации. Рендер тем же <KbArticleBody>, что и
// у пользователя, — предпросмотр совпадает с боевым видом.

interface PreviewData {
  id: string
  title: string
  slug: string
  isPublished: boolean
  section: { id: string; title: string; slug: string }
  blocks: KbArticleBlock[]
}

export default function AdminArticlePreviewPage() {
  const params = useParams<{ articleId: string }>()
  const articleId = params.articleId

  const [article, setArticle] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/admin/kb/articles/${articleId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: PreviewData | null) => setArticle(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [articleId])

  if (loading) return <div className="p-6 text-muted-foreground">Загрузка...</div>
  if (!article)
    return (
      <div className="p-6 text-muted-foreground">
        Статья не найдена.{" "}
        <Link href="/admin/knowledge" className="text-primary hover:underline">
          Назад
        </Link>
      </div>
    )

  return (
    <div className="p-6">
      <Link
        href={`/admin/knowledge/${articleId}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> К редактору
      </Link>

      <div
        className={`mb-5 rounded-md border px-3 py-2 text-sm ${
          article.isPublished
            ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        }`}
      >
        {article.isPublished
          ? "Предпросмотр опубликованной статьи — так её видят пользователи."
          : "Предпросмотр черновика. Статья ещё не опубликована и не видна пользователям."}
      </div>

      <article className="mx-auto max-w-3xl">
        <div className="mb-1 text-xs text-muted-foreground">{article.section.title}</div>
        <h1 className="mb-4 text-2xl font-bold">{article.title}</h1>
        <KbArticleBody blocks={article.blocks} />
      </article>
    </div>
  )
}
