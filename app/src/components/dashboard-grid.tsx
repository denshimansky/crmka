"use client"

import { type ReactNode } from "react"
import {
  DEFAULT_WIDGETS,
  useDashboardWidgetConfig,
} from "@/components/dashboard-settings"

// Widget layout: "full" — на всю ширину; "half" — 50% (батчатся по 2);
// "third" — 33% (батчатся по 3).
const WIDGET_LAYOUT: Record<string, "full" | "half" | "third"> = {
  stats: "full",
  tasks: "half",
  unmarked: "half",
  funnel: "third",
  capacity: "full",
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

  // Group consecutive "half" widgets into 2-col grids, "third" — into 3-col.
  const rendered: ReactNode[] = []
  let halfBatch: ReactNode[] = []
  let thirdBatch: ReactNode[] = []

  function flushHalves() {
    if (halfBatch.length > 0) {
      rendered.push(
        <div key={`grid-${rendered.length}`} className="grid gap-4 lg:grid-cols-2">
          {halfBatch}
        </div>
      )
      halfBatch = []
    }
  }

  function flushThirds() {
    if (thirdBatch.length > 0) {
      rendered.push(
        <div key={`grid-${rendered.length}`} className="grid gap-4 lg:grid-cols-3">
          {thirdBatch}
        </div>
      )
      thirdBatch = []
    }
  }

  function flushAll() {
    flushHalves()
    flushThirds()
  }

  for (const w of visibleWidgets) {
    const layout = WIDGET_LAYOUT[w.id] || "full"
    if (layout === "half") {
      flushThirds()
      halfBatch.push(<div key={w.id}>{widgets[w.id]}</div>)
    } else if (layout === "third") {
      flushHalves()
      thirdBatch.push(<div key={w.id}>{widgets[w.id]}</div>)
    } else {
      flushAll()
      rendered.push(<div key={w.id}>{widgets[w.id]}</div>)
    }
  }
  flushAll()

  return <div className="space-y-6">{rendered}</div>
}
