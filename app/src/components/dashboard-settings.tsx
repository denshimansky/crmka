"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Settings2, ChevronUp, ChevronDown, RotateCcw } from "lucide-react"

export interface WidgetConfig {
  id: string
  label: string
  visible: boolean
}

const STORAGE_KEY = "dashboard-widget-config"
const CHANGE_EVENT = "dashboard-widget-config-change"

export const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "stats", label: "Ключевые показатели", visible: true },
  { id: "tasks", label: "Задачи на сегодня", visible: true },
  { id: "unmarked", label: "Неотмеченные занятия", visible: true },
  { id: "funnel", label: "Воронка продаж", visible: true },
  { id: "capacity", label: "Заполняемость групп", visible: true },
]

export function loadWidgetConfig(): WidgetConfig[] {
  if (typeof window === "undefined") return DEFAULT_WIDGETS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WIDGETS
    const saved: WidgetConfig[] = JSON.parse(raw)
    // Merge with defaults: add any new widgets not in saved config
    const savedIds = new Set(saved.map((w) => w.id))
    const merged = [...saved]
    for (const def of DEFAULT_WIDGETS) {
      if (!savedIds.has(def.id)) {
        merged.push(def)
      }
    }
    // Remove widgets that no longer exist
    const defaultIds = new Set(DEFAULT_WIDGETS.map((w) => w.id))
    return merged.filter((w) => defaultIds.has(w.id))
  } catch {
    return DEFAULT_WIDGETS
  }
}

export function saveWidgetConfig(config: WidgetConfig[]) {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useDashboardWidgetConfig() {
  const [config, setConfig] = useState<WidgetConfig[]>(DEFAULT_WIDGETS)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setConfig(loadWidgetConfig())
    setMounted(true)

    const refresh = () => setConfig(loadWidgetConfig())
    window.addEventListener(CHANGE_EVENT, refresh)
    window.addEventListener("storage", refresh)
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh)
      window.removeEventListener("storage", refresh)
    }
  }, [])

  function update(next: WidgetConfig[]) {
    setConfig(next)
    saveWidgetConfig(next)
  }

  return { config, mounted, update }
}

export function DashboardSettingsButton() {
  const { config, mounted, update } = useDashboardWidgetConfig()
  if (!mounted) return null
  return <DashboardSettings config={config} onChange={update} />
}

export function DashboardSettings({
  config,
  onChange,
}: {
  config: WidgetConfig[]
  onChange: (config: WidgetConfig[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<WidgetConfig[]>(config)

  function handleOpen(isOpen: boolean) {
    if (isOpen) setLocal(config)
    setOpen(isOpen)
  }

  function toggle(id: string) {
    setLocal((prev) =>
      prev.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w))
    )
  }

  function moveUp(index: number) {
    if (index === 0) return
    setLocal((prev) => {
      const next = [...prev]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      return next
    })
  }

  function moveDown(index: number) {
    setLocal((prev) => {
      if (index >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      return next
    })
  }

  function reset() {
    setLocal(DEFAULT_WIDGETS)
  }

  function save() {
    onChange(local)
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5" />
        }
      >
        <Settings2 className="size-4" />
        <span className="hidden sm:inline">Настроить</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Настройка дашборда</DialogTitle>
          <DialogDescription>
            Включайте/выключайте виджеты и меняйте их порядок
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          {local.map((widget, index) => (
            <div
              key={widget.id}
              className="flex items-center gap-2 rounded-md border p-2"
            >
              <Switch
                checked={widget.visible}
                onCheckedChange={() => toggle(widget.id)}
              />
              <span className="flex-1 text-sm font-medium">
                {widget.label}
              </span>
              <div className="flex gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => moveDown(index)}
                  disabled={index === local.length - 1}
                >
                  <ChevronDown className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5">
            <RotateCcw className="size-3.5" />
            Сбросить
          </Button>
          <Button size="sm" onClick={save}>
            Сохранить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
