import { getKbNavTree } from "@/lib/kb"
import { KbSidebar } from "@/components/kb/kb-sidebar"

// Общий каркас читалки базы знаний: слева — навигация (дерево + поиск),
// справа — контент страницы. Дерево грузится один раз для всех страниц раздела.
export default async function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  const tree = await getKbNavTree()
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
