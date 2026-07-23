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
import { Settings2, RotateCcw, ChevronUp, ChevronDown } from "lucide-react"

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
  { id: "expectedIncome", label: "Ожидаемые поступления средств", visible: true },
  { id: "activeSubs", label: "Активные абонементы", visible: true },
  { id: "profitForecast", label: "Прогноз прибыли", visible: true },
  { id: "missedTrials", label: "Не пришли на пробник", visible: true },
  { id: "unmarked", label: "Неотмеченные занятия", visible: true },
  { id: "funnel", label: "Воронка продаж", visible: true },
  { id: "capacity", label: "Заполняемость групп", visible: true },
  { id: "cashBalances", label: "Остатки денег", visible: true },
  { id: "birthdays", label: "Дни рождения", visible: true },
  { id: "workedSubs", label: "Отработанные абонементы", visible: true },
  { id: "plannedExpenses", label: "Плановые расходы", visible: true },
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

export function DashboardSettingsButton({
  allowedWidgetIds,
}: {
  // Виджеты, доступные роли (гейтинг по правам считается на сервере в page.tsx).
  // Настройки показывают только их — чтобы нельзя было включить виджет, который
  // всё равно не отрендерится. undefined — ограничения нет (показываем все).
  allowedWidgetIds?: string[]
}) {
  const { config, mounted, update } = useDashboardWidgetConfig()
  if (!mounted) return null
  return (
    <DashboardSettings
      config={config}
      onChange={update}
      allowedWidgetIds={allowedWidgetIds}
    />
  )
}

export function DashboardSettings({
  config,
  onChange,
  allowedWidgetIds,
}: {
  config: WidgetConfig[]
  onChange: (config: WidgetConfig[]) => void
  allowedWidgetIds?: string[]
}) {
  const [open, setOpen] = useState(false)

  // В диалоге показываем и настраиваем только доступные роли виджеты. Скрытые
  // (недоступные) сохраняем в конфиге как есть, чтобы при смене прав их
  // положение/видимость не потерялись.
  const isAllowed = (id: string) =>
    !allowedWidgetIds || allowedWidgetIds.includes(id)
  const filterAllowed = (list: WidgetConfig[]) => list.filter((w) => isAllowed(w.id))

  const [local, setLocal] = useState<WidgetConfig[]>(() => filterAllowed(config))

  function handleOpen(isOpen: boolean) {
    if (isOpen) setLocal(filterAllowed(config))
    setOpen(isOpen)
  }

  const maxVisible = local.length
  const visibleCount = local.filter((w) => w.visible).length

  function toggle(id: string) {
    setLocal((prev) => {
      const visible = prev.filter((w) => w.visible).length
      return prev.map((w) => {
        if (w.id !== id) return w
        if (!w.visible && visible >= maxVisible) return w
        return { ...w, visible: !w.visible }
      })
    })
  }

  // Сдвиг виджета на одну позицию вверх/вниз (dir=-1/+1). Заменил редактируемое
  // числовое поле: на мобильном оно было неюзабельным — цифру нельзя очистить
  // (input контролируется значением index+1), а новая цифра дописывалась к
  // старой («5»→«52»), давая большое число, которое клампилось в конец списка.
  function move(id: string, dir: -1 | 1) {
    setLocal((prev) => {
      const idx = prev.findIndex((w) => w.id === id)
      const target = idx + dir
      if (idx === -1 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  function reset() {
    setLocal(DEFAULT_WIDGETS)
  }

  function save() {
    // Дописываем обратно виджеты, которых нет в диалоге (недоступные роли), —
    // сохраняем их прежнее состояние из config, чтобы не потерять при смене прав.
    const hidden = config.filter((w) => !isAllowed(w.id))
    onChange([...local, ...hidden])
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
            Включайте/выключайте виджеты и меняйте порядок стрелками.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          {local.map((widget, index) => {
            const atLimit = !widget.visible && visibleCount >= maxVisible
            return (
              <div
                key={widget.id}
                className="flex items-center gap-2 rounded-md border p-2"
              >
                <Switch
                  checked={widget.visible}
                  onCheckedChange={() => toggle(widget.id)}
                  disabled={atLimit}
                />
                <span className="flex-1 text-sm font-medium">
                  {widget.label}
                </span>
                <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  disabled={index === 0}
                  onClick={() => move(widget.id, -1)}
                  aria-label={`Поднять выше: ${widget.label}`}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  disabled={index === local.length - 1}
                  onClick={() => move(widget.id, 1)}
                  aria-label={`Опустить ниже: ${widget.label}`}
                >
                  <ChevronDown className="size-4" />
                </Button>
              </div>
            )
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Включено {visibleCount} из {local.length}
        </p>

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
