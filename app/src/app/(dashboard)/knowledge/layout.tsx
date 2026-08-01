import { getKbNavTree, kbVariantForTenant } from "@/lib/kb"
import { getSession } from "@/lib/session"
import { KbSidebar } from "@/components/kb/kb-sidebar"

// Общий каркас читалки базы знаний: слева — навигация (дерево + поиск),
// справа — контент страницы. Дерево грузится один раз для всех страниц раздела.
// Показываем вкладку базы знаний по типу абонемента организации.
export default async function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const variant = await kbVariantForTenant(session.user.tenantId)
  const tree = await getKbNavTree(variant)
  return (
    <div className="p-4 md:p-6">
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside>
          <KbSidebar tree={tree} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
