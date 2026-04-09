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
import {
  Select, SelectTrigger, SelectContent, SelectItem,
} from "@/components/ui/select"
import { CalendarX } from "lucide-react"

interface Branch {
  id: string
  name: string
}

interface CancelDayDialogProps {
  defaultDate: string // YYYY-MM-DD
  branches: Branch[]
}

const PRESET_REASONS = [
  "Праздник",
  "Карантин",
  "Санитарный день",
  "Форс-мажор",
]

export function CancelDayDialog({ defaultDate, branches }: CancelDayDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const [date, setDate] = useState(defaultDate)
  const [branchId, setBranchId] = useState<string>("")
  const [reason, setReason] = useState("")

  function reset() {
    setDate(defaultDate)
    setBranchId("")
    setReason("")
    setError(null)
    setResult(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    if (!reason.trim()) {
      setError("Укажите причину отмены")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/lessons/cancel-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          branchId: branchId || undefined,
          reason: reason.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при отмене")
        return
      }

      const data = await res.json()
      setResult(`Отменено занятий: ${data.cancelled}`)
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
        <CalendarX className="mr-1 size-4" />
        Отменить день
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Массовая отмена занятий</DialogTitle>
            <DialogDescription>
              Отмените все занятия за выбранную дату (праздник, карантин и т.д.)
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
              <Label htmlFor="cd-date">Дата</Label>
              <Input
                id="cd-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            {branches.length > 1 && (
              <div>
                <Label>Филиал (опционально)</Label>
                <Select value={branchId} onValueChange={(v) => setBranchId(v || "")}>
                  <SelectTrigger className="w-full">
                    {branchId
                      ? branches.find((b) => b.id === branchId)?.name
                      : <span className="text-muted-foreground">Все филиалы</span>}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Все филиалы</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="cd-reason">Причина *</Label>
              <Input
                id="cd-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Укажите причину отмены"
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {PRESET_REASONS.map((r) => (
                  <Button
                    key={r}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => setReason(r)}
                  >
                    {r}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" type="button" />}>
              Закрыть
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={loading}>
              {loading ? "Отмена..." : "Отменить занятия"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
