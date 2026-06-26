"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { CalendarPlus, AlertCircle } from "lucide-react"

interface Candidate {
  sourceSubscriptionId: string
  clientName: string
  wardName: string | null
  directionName: string
  groupName: string
  branchName: string
  lessonPrice: number
  totalLessons: number
  finalAmount: number
}

interface Skipped {
  sourceSubscriptionId: string
  clientName: string
  wardName: string | null
  directionName: string
  groupName: string
  reason: "already_renewed" | "no_schedule_lessons"
}

interface PreviewResp {
  rangeStart: string
  rangeEnd: string
  toCreate: Candidate[]
  skipped: Skipped[]
}

interface CommitResp {
  created: number
  skipped: number
  totalIssuedAmount: number
}

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function defaultRange(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0) // last day of next month
  return { start: ymd(start), end: ymd(end) }
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

function skipLabel(r: Skipped["reason"]): string {
  if (r === "already_renewed") return "уже выписан на этот период"
  return "у группы нет расписания на период"
}

export function RenewButton({
  branchId,
  directionId,
}: {
  branchId: string | null
  directionId: string | null
}) {
  const router = useRouter()
  const def = useMemo(defaultRange, [])
  const [open, setOpen] = useState(false)
  const [rangeStart, setRangeStart] = useState(def.start)
  const [rangeEnd, setRangeEnd] = useState(def.end)
  const [useFilters, setUseFilters] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResp | null>(null)
  const [commit, setCommit] = useState<CommitResp | null>(null)

  function reset() {
    setRangeStart(def.start)
    setRangeEnd(def.end)
    setUseFilters(true)
    setError(null)
    setPreview(null)
    setCommit(null)
    setLoading(false)
  }

  function body() {
    return {
      rangeStart,
      rangeEnd,
      branchId: useFilters ? branchId : null,
      directionId: useFilters ? directionId : null,
    }
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault()
    if (rangeStart > rangeEnd) {
      setError("Начало периода позже конца")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/subscriptions/bulk-renew/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Ошибка ${res.status}`)
        return
      }
      setPreview(await res.json())
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  async function handleCommit() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/subscriptions/bulk-renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Ошибка ${res.status}`)
        return
      }
      setCommit(await res.json())
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <CalendarPlus className="size-4" />
        Выписать абонементы на следующий период
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Массовая выписка абонементов</DialogTitle>
            <DialogDescription>
              Создаёт абонементы со статусом <b>«Ожидает оплаты»</b> для каждого
              ребёнка, у которого сейчас есть <b>активный</b> календарный абонемент.
              Цена занятия копируется из текущего абонемента, число занятий считается по
              расписанию группы за указанный период (с учётом производственного календаря).
              Скидки в этой версии не переносятся.
            </DialogDescription>
          </DialogHeader>

          {!preview && !commit && (
            <form onSubmit={handlePreview} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Начало периода</Label>
                  <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Конец периода</Label>
                  <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
                </div>
              </div>
              {(branchId || directionId) && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={useFilters}
                    onCheckedChange={(v) => setUseFilters(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Учитывать текущие фильтры таблицы
                    {branchId ? " (Филиал)" : ""}
                    {branchId && directionId ? " и" : ""}
                    {directionId ? " (Направление)" : ""}
                  </span>
                </label>
              )}
              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
                  <AlertCircle className="size-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <DialogFooter>
                <Button type="submit" disabled={loading}>
                  {loading ? "Считаю…" : "Предосмотр"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {preview && !commit && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 px-3 py-2 text-sm space-y-1">
                <div>
                  Период: <b>{preview.rangeStart}</b> – <b>{preview.rangeEnd}</b>
                </div>
                <div>
                  Будет выписано: <b>{preview.toCreate.length}</b>{" "}
                  абонементов · пропущено: <b>{preview.skipped.length}</b>
                </div>
                <div className="text-muted-foreground text-xs">
                  Итого к оплате:{" "}
                  <b>
                    {fmt(preview.toCreate.reduce((s, c) => s + c.finalAmount, 0))} ₽
                  </b>
                </div>
              </div>

              {preview.toCreate.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-sm">
                    Что именно выпишем ({preview.toCreate.length})
                  </summary>
                  <ul className="mt-2 max-h-56 overflow-y-auto space-y-1 pl-4 list-disc">
                    {preview.toCreate.slice(0, 200).map((c) => (
                      <li key={c.sourceSubscriptionId}>
                        {c.wardName ?? c.clientName} · {c.directionName} ·{" "}
                        {c.groupName} ({c.branchName}) — {c.totalLessons} зан. ×{" "}
                        {fmt(c.lessonPrice)} ₽ = <b>{fmt(c.finalAmount)} ₽</b>
                      </li>
                    ))}
                    {preview.toCreate.length > 200 && (
                      <li className="text-muted-foreground">
                        … и ещё {preview.toCreate.length - 200}
                      </li>
                    )}
                  </ul>
                </details>
              )}

              {preview.skipped.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-sm">
                    Пропущено ({preview.skipped.length})
                  </summary>
                  <ul className="mt-2 max-h-56 overflow-y-auto space-y-1 pl-4 list-disc">
                    {preview.skipped.slice(0, 200).map((s) => (
                      <li key={s.sourceSubscriptionId}>
                        {s.wardName ?? s.clientName} · {s.directionName} ·{" "}
                        {s.groupName} — <i>{skipLabel(s.reason)}</i>
                      </li>
                    ))}
                    {preview.skipped.length > 200 && (
                      <li className="text-muted-foreground">
                        … и ещё {preview.skipped.length - 200}
                      </li>
                    )}
                  </ul>
                </details>
              )}

              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
                  <AlertCircle className="size-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setPreview(null)} disabled={loading}>
                  Назад
                </Button>
                <Button onClick={handleCommit} disabled={loading || preview.toCreate.length === 0}>
                  {loading
                    ? "Выписываю…"
                    : `Выписать ${preview.toCreate.length} абонементов`}
                </Button>
              </DialogFooter>
            </div>
          )}

          {commit && (
            <div className="space-y-4">
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm space-y-1">
                <div className="font-medium text-emerald-700 dark:text-emerald-500">
                  Выписка завершена
                </div>
                <div className="text-xs text-muted-foreground">
                  Создано абонементов «Ожидает оплаты»: <b>{commit.created}</b> · пропущено:{" "}
                  <b>{commit.skipped}</b>
                </div>
                <div className="text-xs text-muted-foreground">
                  Итого к оплате: <b>{fmt(commit.totalIssuedAmount)} ₽</b>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Закрыть</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
