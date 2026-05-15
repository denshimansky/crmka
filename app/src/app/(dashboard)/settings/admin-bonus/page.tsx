import { PageHelp } from "@/components/page-help"
import { AdminBonusContent } from "./admin-bonus-content"

export default function AdminBonusPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Бонусы администраторов</h1>
          <PageHelp pageKey="settings/admin-bonus" />
        </div>
        <p className="text-sm text-muted-foreground">
          Настройка вознаграждений за пробные, продажи и допродажи
        </p>
      </div>
      <AdminBonusContent />
    </div>
  )
}
