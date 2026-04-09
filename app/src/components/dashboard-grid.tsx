"use client"

import { useState, useEffect, type ReactNode } from "react"
import {
  DashboardSettings,
  loadWidgetConfig,
  saveWidgetConfig,
  DEFAULT_WIDGETS,
  type WidgetConfig,
} from "@/components/dashboard-settings"

// Widget layout: "full" takes full width, "third" goes into a 3-col grid
const WIDGET_LAYOUT: Record<string, "full" | "third"> = {
  stats: "full",
  tasks: "third",
  unmarked: "third",
  funnel: "third",
  capacity: "full",
}

interface DashboardGridProps {
  widgets: Record<string, ReactNode>
}

export function DashboardGrid({ widgets }: DashboardGridProps) {
  const [config, setConfig] = useState<WidgetConfig[]>(DEFAULT_WIDGETS)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setConfig(loadWidgetConfig())
    setMounted(true)
  }, [])

  function handleChange(newConfig: WidgetConfig[]) {
    setConfig(newConfig)
    saveWidgetConfig(newConfig)
  }

  // Before hydration, show all widgets in default order (matches server)
  const activeConfig = mounted ? config : DEFAULT_WIDGETS

  const visibleWidgets = activeConfig.filter(
    (w) => w.visible && widgets[w.id] != null
  )

  // Group consecutive "third" widgets into 3-col grids
  const rendered: ReactNode[] = []
  let thirdBatch: ReactNode[] = []

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

  for (const w of visibleWidgets) {
    const layout = WIDGET_LAYOUT[w.id] || "full"
    if (layout === "third") {
      thirdBatch.push(<div key={w.id}>{widgets[w.id]}</div>)
    } else {
      flushThirds()
      rendered.push(<div key={w.id}>{widgets[w.id]}</div>)
    }
  }
  flushThirds()

  return (
    <>
      {mounted && (
        <div className="flex justify-end -mt-2 -mb-2">
          <DashboardSettings config={config} onChange={handleChange} />
        </div>
      )}
      {rendered}
    </>
  )
}
