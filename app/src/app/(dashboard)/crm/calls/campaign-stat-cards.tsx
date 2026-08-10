import { Card, CardContent } from "@/components/ui/card"
import type { LucideIcon } from "lucide-react"

/** Один показатель обзвона: метка, всего и за сегодня, иконка + цвета. */
export interface CampaignStat {
  key: string
  label: string
  total: number
  today: number
  icon: LucideIcon
  color: string
  bg: string
}

/**
 * Показатели обзвона в два ряда по 5 карточек (спека Ани): верхний ряд —
 * «всего», нижний — «за сегодня» те же показатели. Колонки выровнены, поэтому
 * идентичность метрики в нижнем ряду задаёт та же иконка/цвет и позиция.
 * Общий компонент для страницы списка обзвонов и карточки кампании.
 */
export function CampaignStatCards({ stats }: { stats: CampaignStat[] }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((c) => (
          <StatCard key={c.key} c={c} label={c.label} value={c.total} />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((c) => (
          <StatCard key={c.key} c={c} label="за сегодня" value={c.today} />
        ))}
      </div>
    </div>
  )
}

function StatCard({ c, label, value }: { c: CampaignStat; label: string; value: number }) {
  const Icon = c.icon
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${c.bg}`}>
            <Icon className={`size-4 ${c.color}`} />
          </div>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
        <p className={`mt-2 text-2xl font-bold ${c.color}`}>{value}</p>
      </CardContent>
    </Card>
  )
}
