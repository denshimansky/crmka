import Link from "next/link"
import { getKbNavTree, firstArticleHref, kbVariantForTenant } from "@/lib/kb"
import { getSession } from "@/lib/session"
import { PageHelp } from "@/components/page-help"
import { Button } from "@/components/ui/button"

// Лендинг базы знаний: только приветствие и кнопка «Начать чтение».
// Навигация по разделам живёт слева (KbSidebar в layout), контент статьи —
// справа после выбора. Дублировать список статей на лендинге не нужно.
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
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Выберите раздел в навигации слева — статья откроется здесь.
          </p>
          {firstHref && (
            <Button render={<Link href={firstHref} />} size="sm">
              Начать чтение
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
