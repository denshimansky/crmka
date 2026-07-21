"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown, ChevronRight, ListTree } from "lucide-react"
import { cn } from "@/lib/utils"
import { KbSearch } from "./kb-search"
import type { KbNavSection, KbNavArticle } from "@/lib/kb"

function ArticleLink({
  sectionSlug,
  article,
  active,
}: {
  sectionSlug: string
  article: KbNavArticle
  active: boolean
}) {
  return (
    <Link
      href={`/knowledge/${sectionSlug}/${article.slug}`}
      className={cn(
        "block rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {article.title}
    </Link>
  )
}

function SectionArticles({
  section,
  activeSection,
  activeArticle,
}: {
  section: KbNavSection
  activeSection?: string
  activeArticle?: string
}) {
  return (
    <div className="ml-1 space-y-0.5 border-l pl-2">
      {section.articles.map((a) => (
        <ArticleLink
          key={a.slug}
          sectionSlug={section.slug}
          article={a}
          active={activeSection === section.slug && activeArticle === a.slug}
        />
      ))}
      {section.children.map((sub) => (
        <div key={sub.id} className="mt-1">
          <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {sub.title}
          </div>
          {sub.articles.map((a) => (
            <ArticleLink
              key={a.slug}
              sectionSlug={sub.slug}
              article={a}
              active={activeSection === sub.slug && activeArticle === a.slug}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function KbSidebar({ tree }: { tree: KbNavSection[] }) {
  const pathname = usePathname()
  const parts = pathname.split("/").filter(Boolean)
  const activeSection = parts[0] === "knowledge" ? parts[1] : undefined
  const activeArticle = parts[0] === "knowledge" ? parts[2] : undefined

  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(tree.map((t) => t.id)))
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="lg:sticky lg:top-4">
      <div className="mb-3">
        <KbSearch />
      </div>

      {/* Мобильный тумблер навигации */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        className="mb-2 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium lg:hidden"
      >
        <ListTree className="size-4" />
        Содержание
        <ChevronDown className={cn("ml-auto size-4 transition-transform", mobileOpen && "rotate-180")} />
      </button>

      <nav className={cn("space-y-1", mobileOpen ? "block" : "hidden", "lg:block")}>
        {tree.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted-foreground">Разделов пока нет</p>
        )}
        {tree.map((top) => {
          const isOpen = openIds.has(top.id)
          return (
            <div key={top.id}>
              <button
                type="button"
                onClick={() => toggle(top.id)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-sm font-semibold hover:bg-accent"
              >
                {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                <span className="flex-1">{top.title}</span>
              </button>
              {isOpen && (
                <SectionArticles
                  section={top}
                  activeSection={activeSection}
                  activeArticle={activeArticle}
                />
              )}
            </div>
          )
        })}
      </nav>
    </div>
  )
}
