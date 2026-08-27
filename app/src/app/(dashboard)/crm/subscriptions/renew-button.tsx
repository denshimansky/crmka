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
import { useCurrencySymbol } from "@/components/currency-provider"
import { CalendarPlus, AlertCircle, ArrowRight } from "lucide-react"

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

interface OffPeriodBucket {
  year: number
  month: number
  count: number
}

interface PreviewResp {
  rangeStart: string
  rangeEnd: string
  toCreate: Candidate[]
  skipped: Skipped[]
  offPeriodClosed?: OffPeriodBucket[]
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

const MONTHS_RU = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

// YYYY-MM-DD границы календарного месяца (1..12) для быстрого переключения периода.
function monthRange(year: number, month1: number): { start: string; end: string } {
  const start = new Date(year, month1 - 1, 1)
  const end = new Date(year, month1, 0) // последний день месяца month1
  return { start: ymd(start), end: ymd(end) }
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

// «YYYY-MM-DD» → «Август 2026» для подсказки о предложенном месяце.
function monthLabel(ymdStr: string): string {
  const [y, m] = ymdStr.split("-").map(Number)
  if (!y || !m || m < 1 || m > 12) return ymdStr
  return `${MONTHS_RU[m - 1]} ${y}`
}

function skipLabel(r: Skipped["reason"]): string {
  if (r === "already_renewed") return "уже выписан на этот период"
  return "у группы нет расписания на период"
}

export function RenewButton({
  branchId,
  directionId,
  defaultRangeStart,
  defaultRangeEnd,
  defaultRangeReason,
}: {
  branchId: string | null
  directionId: string | null
  // (а) Серверный умный дефолт периода. Если не передан — падаем на клиентский
  // «следующий месяц» (defaultRange), чтобы поведение не сломалось.
  defaultRangeStart?: string | null
  defaultRangeEnd?: string | null
  // Почему предложен этот месяц: current_backlog — за текущий ещё есть
  // невыписанные; next_period — штатно на месяц вперёд. Для подсказки под датами.
  defaultRangeReason?: "current_backlog" | "next_period" | null
}) {
  const router = useRouter()
  const sym = useCurrencySymbol()
  const def = useMemo(
    () =>
      defaultRangeStart && defaultRangeEnd
        ? { start: defaultRangeStart, end: defaultRangeEnd }
        : defaultRange(),
    [defaultRangeStart, defaultRangeEnd],
  )
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

  async function runPreview(rs: string, re: string) {
    if (rs > re) {
      setError("Начало периода позже конца")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/subscriptions/bulk-renew/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rangeStart: rs,
          rangeEnd: re,
          branchId: useFilters ? branchId : null,
          directionId: useFilters ? directionId : null,
        }),
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

  function handlePreview(e: React.FormEvent) {
    e.preventDefault()
    runPreview(rangeStart, rangeEnd)
  }

  // (б) Переключить период на подсказанный месяц и сразу пересчитать превью.
  function switchPeriod(year: number, month: number) {
    const { start, end } = monthRange(year, month)
    setRangeStart(start)
    setRangeEnd(end)
    runPreview(start, end)
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
              ребёнка, у которого за прошлый месяц был календарный абонемент.
              Продлеваются <b>активные</b>, <b>закрытые</b> и <b>неоплаченные</b>
              {" "}(с частичной оплатой или с посещениями). НЕ продлеваются
              «пустые» (ни оплаты, ни занятий) и снятые вручную (отчисленные, с
              запланированным отчислением). Цена занятия — по актуальному прайсу
              направления, число занятий — по расписанию группы за период (с
              учётом производственного календаря). Скидки пересчитаются
              автоматически после выписки.
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
              {defaultRangeReason &&
                rangeStart === def.start &&
                rangeEnd === def.end && (
                  <p className="text-xs text-muted-foreground">
                    {defaultRangeReason === "current_backlog" ? (
                      <>
                        Предложен <b>{monthLabel(rangeStart)}</b>: за него ещё
                        остались невыписанные абонементы. Обычно выписывают на
                        месяц вперёд — поменяйте даты, если нужен следующий период.
                      </>
                    ) : (
                      <>
                        Предложен <b>{monthLabel(rangeStart)}</b> — следующий
                        период.
                      </>
                    )}
                  </p>
                )}
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
                    {fmt(preview.toCreate.reduce((s, c) => s + c.finalAmount, 0))} {sym}
                  </b>
                </div>
              </div>

              {preview.offPeriodClosed && preview.offPeriodClosed.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
                    <div>
                      <div className="font-medium text-amber-700 dark:text-amber-500">
                        {preview.toCreate.length === 0
                          ? "Похоже, выбран не тот месяц"
                          : "Есть абонементы за другой месяц"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {preview.toCreate.length === 0
                          ? "За выбранный период продлевать нечего. Но эти абонементы пора продлить в другой месяц — их прошлый месяц уже закрыт или оплачен. Нажмите месяц ниже, чтобы переключиться и выписать их."
                          : "Кроме выписки за выбранный период, часть абонементов относится к другим прошлым месяцам. Нажмите месяц, чтобы переключиться на него."}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.offPeriodClosed.map((b) => (
                      <Button
                        key={`${b.year}-${b.month}`}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loading}
                        onClick={() => switchPeriod(b.year, b.month)}
                      >
                        {MONTHS_RU[b.month - 1]} {b.year} · {b.count}
                        <ArrowRight className="size-3.5" />
                      </Button>
                    ))}
                  </div>
                </div>
              )}

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
                        {fmt(c.lessonPrice)} {sym} = <b>{fmt(c.finalAmount)} {sym}</b>
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
                  Итого к оплате: <b>{fmt(commit.totalIssuedAmount)} {sym}</b>
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
