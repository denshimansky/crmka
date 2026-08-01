import Link from "next/link"
import { getKbNavTree, firstArticleHref, kbVariantForTenant } from "@/lib/kb"
import { getSession } from "@/lib/session"
import { PageHelp } from "@/components/page-help"
import { Button } from "@/components/ui/button"

// Лендинг базы знаний: приветствие + карточки разделов со ссылками на статьи.
// Раздел показывает вкладку по типу абонемента организации.
export default async function KnowledgePage() {
  const session = await getSession()
  const variant = await kbVariantForTenant(session.user.tenantId)
  const tree = await getKbNavTree(variant)
  const firstHref = firstArticleHref(tree)

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-2xl font-bold">База знаний</h1>
        <PageHelp pageKey="knowledge" />
      </div>

      {tree.length === 0 ? (
        <p className="text-muted-foreground">База знаний пока пуста.</p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Выберите раздел в навигации слева или начните с первой статьи.
            </p>
            {firstHref && (
              <Button render={<Link href={firstHref} />} size="sm">
                Начать чтение
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {tree.map((top) => (
              <div key={top.id} className="rounded-lg border p-4">
                <h2 className="mb-2 font-semibold">{top.title}</h2>
                <ul className="space-y-1">
                  {top.articles.map((a) => (
                    <li key={a.slug}>
                      <Link className="text-sm text-primary hover:underline" href={`/knowledge/${top.slug}/${a.slug}`}>
                        {a.title}
                      </Link>
                    </li>
                  ))}
                  {top.children.flatMap((sub) =>
                    sub.articles.map((a) => (
                      <li key={`${sub.slug}-${a.slug}`}>
                        <Link className="text-sm text-primary hover:underline" href={`/knowledge/${sub.slug}/${a.slug}`}>
                          {a.title}
                        </Link>
                      </li>
                    )),
                  )}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
