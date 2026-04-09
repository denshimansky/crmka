"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Copy } from "lucide-react"

function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function getNextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m, 1) // month is 0-indexed, so m (1-indexed) gives next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
}

export function CopyMonthDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const [sourceMonth, setSourceMonth] = useState(getCurrentMonth())
  const [targetMonth, setTargetMonth] = useState(getNextMonth(getCurrentMonth()))

  function reset() {
    const current = getCurrentMonth()
    setSourceMonth(current)
    setTargetMonth(getNextMonth(current))
    setError(null)
    setResult(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (!sourceMonth || !targetMonth) {
      setError("Укажите оба месяца")
      return
    }

    if (sourceMonth === targetMonth) {
      setError("Исходный и целевой месяц совпадают")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/schedule/copy-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceMonth, targetMonth }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || "Ошибка при копировании")
        return
      }

      setResult(`Скопировано занятий: ${data.created}`)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) reset()
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Copy className="mr-1 size-4" />
        Копировать месяц
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Копировать расписание на месяц</DialogTitle>
            <DialogDescription>
              Скопировать все занятия из одного месяца в другой. Занятия, которые уже существуют в целевом месяце, будут пропущены.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            {result && (
              <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
                {result}
              </div>
            )}

            <div>
              <Label htmlFor="cm-source">Из месяца</Label>
              <Input
                id="cm-source"
                type="month"
                value={sourceMonth}
                onChange={(e) => {
                  setSourceMonth(e.target.value)
                  if (e.target.value) {
                    setTargetMonth(getNextMonth(e.target.value))
                  }
                }}
              />
              {sourceMonth && (
                <p className="mt-1 text-xs text-muted-foreground">{formatMonth(sourceMonth)}</p>
              )}
            </div>

            <div>
              <Label htmlFor="cm-target">В месяц</Label>
              <Input
                id="cm-target"
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
              />
              {targetMonth && (
                <p className="mt-1 text-xs text-muted-foreground">{formatMonth(targetMonth)}</p>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" type="button" />}>
              Закрыть
            </DialogClose>
            <Button type="submit" disabled={loading}>
              {loading ? "Копирование..." : "Копировать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
