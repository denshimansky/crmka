"use client"

import { type ReactNode } from "react"
import {
  DEFAULT_WIDGETS,
  useDashboardWidgetConfig,
} from "@/components/dashboard-settings"

// "full" — на всю ширину рабочей области.
// "compact" — половина или меньше; такие виджеты автоматически пàрятся
// в строку из двух соседних compact'ов независимо от того, есть ли между
// ними full-виджет в пользовательском порядке.
const WIDGET_LAYOUT: Record<string, "full" | "compact"> = {
  stats: "full",
  tasks: "compact",
  expectedIncome: "compact",
  activeSubs: "full",
  profitForecast: "full",
  missedTrials: "full",
  unmarked: "compact",
  funnel: "compact",
  capacity: "compact",
  cashBalances: "compact",
  birthdays: "compact",
  workedSubs: "compact",
}

interface DashboardGridProps {
  widgets: Record<string, ReactNode>
}

export function DashboardGrid({ widgets }: DashboardGridProps) {
  const { config, mounted } = useDashboardWidgetConfig()

  // Before hydration, show all widgets in default order (matches server)
  const activeConfig = mounted ? config : DEFAULT_WIDGETS

  const visibleWidgets = activeConfig.filter(
    (w) => w.visible && widgets[w.id] != null
  )

  // Жадно собираем строки: full → отдельная строка; compact ищет следующий
  // непривязанный compact и объединяется с ним в grid-cols-2. Полные виджеты
  // между ними не мешают паре — они просто рендерятся ниже.
  const consumed = new Set<number>()
  const rendered: ReactNode[] = []

  for (let i = 0; i < visibleWidgets.length; i++) {
    if (consumed.has(i)) continue
    const w = visibleWidgets[i]
    const layout = WIDGET_LAYOUT[w.id] || "full"

    if (layout === "full") {
      rendered.push(<div key={w.id}>{widgets[w.id]}</div>)
      consumed.add(i)
      continue
    }

    // compact — ищем следующего compact-собрата
    let partnerIdx = -1
    for (let j = i + 1; j < visibleWidgets.length; j++) {
      if (consumed.has(j)) continue
      const layoutJ = WIDGET_LAYOUT[visibleWidgets[j].id] || "full"
      if (layoutJ === "compact") {
        partnerIdx = j
        break
      }
    }

    if (partnerIdx === -1) {
      // одиночный compact — на полную ширину, чтобы не висел в полупустом ряду
      rendered.push(<div key={w.id}>{widgets[w.id]}</div>)
      consumed.add(i)
    } else {
      const partner = visibleWidgets[partnerIdx]
      rendered.push(
        <div key={`row-${w.id}-${partner.id}`} className="grid gap-4 lg:grid-cols-2">
          <div>{widgets[w.id]}</div>
          <div>{widgets[partner.id]}</div>
        </div>
      )
      consumed.add(i)
      consumed.add(partnerIdx)
    }
  }

  return <div className="space-y-6">{rendered}</div>
}
