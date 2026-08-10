"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { Database, ListChecks } from "lucide-react"
import { MANAGED_TRIGGERS, TRIGGER_LABEL } from "@/lib/tasks/trigger-settings"

// Статус клиента — единый селект отбора базы. «Связь» (назначена дата следующей
// связи) перенесён сюда из бывшего «Этапа воронки». Архив / Чёрный список /
// Нецелевой убраны: обзвон по базам их не таргетирует — они глобально
// исключаются в base-режиме (см. lib/call-campaigns/filter.ts).
const CLIENT_STATUS_OPTIONS = [
  { value: "", label: "Все" },
  { value: "leads", label: "Лиды" },
  { value: "active", label: "Активные" },
  { value: "churned", label: "Выбывшие" },
  { value: "potential", label: "Потенциал" },
  { value: "contact", label: "Связь" },
]

// unmarked_lesson создаётся без clientId (задача инструктору про занятие) —
// через Client.tasks клиентов не находит, в обзвоне чекбокс был бы мёртвым.
const CALL_TRIGGERS = MANAGED_TRIGGERS.filter((t) => t !== "unmarked_lesson")

interface BranchOption {
  id: string
  name: string
}

// Сентинел значения селекта «Филиал»: "" = Все, NO_BRANCH = без филиала на
// карточке (branchId/lastBranchId/prevBranchId все NULL — см. filter.ts). Не UUID,
// чтобы не пересечься с реальным id филиала. Баг #113.
const NO_BRANCH = "__none__"

type PreviewState = { count: number } | "error" | null

// Live-предпросмотр размера выборки (debounce). Считается, пока открыт диалог.
// ready=false — критерии ещё не готовы (например, не выбраны типы задач).
function useCampaignPreview(
  open: boolean,
  ready: boolean,
  buildFilterCriteria: () => Record<string, unknown>,
): PreviewState {
  const [preview, setPreview] = useState<PreviewState>(null)
  useEffect(() => {
    if (!open || !ready) { setPreview(null); return }
    const fc = buildFilterCriteria()
    let cancelled = false
    const handle = setTimeout(() => {
      fetch("/api/call-campaigns/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filterCriteria: fc }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("preview failed"))))
        .then((d) => { if (!cancelled) setPreview({ count: d.count }) })
        .catch(() => { if (!cancelled) setPreview("error") })
    }, 400)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [open, ready, buildFilterCriteria])
  return preview
}

function previewLabel(preview: PreviewState): string {
  if (preview === "error") return "Не удалось оценить выборку"
  if (preview) return `Найдено: ${preview.count} клиентов`
  return "Подбор выборки…"
}

async function createCampaign(name: string, fc: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/call-campaigns", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, filterCriteria: fc }),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    return d.error || "Ошибка"
  }
  return null
}

/** «Обзвон по базам» — отбор клиентов по фильтрам базы. */
export function CreateCampaignDialog({ branches }: { branches: BranchOption[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [clientStatus, setClientStatus] = useState("")
  const [branchId, setBranchId] = useState("")
  const [birthFrom, setBirthFrom] = useState("")
  const [birthTo, setBirthTo] = useState("")
  const [withdrawnFrom, setWithdrawnFrom] = useState("")
  const [withdrawnTo, setWithdrawnTo] = useState("")

  function reset() {
    setName(""); setClientStatus(""); setBranchId("")
    setBirthFrom(""); setBirthTo("")
    setWithdrawnFrom(""); setWithdrawnTo("")
    setError(null)
  }

  const buildFilterCriteria = useCallback((): Record<string, unknown> => {
    const fc: Record<string, unknown> = {}
    if (clientStatus) fc.clientStatus = clientStatus
    if (branchId === NO_BRANCH) fc.noBranch = true
    else if (branchId) fc.branchId = branchId
    // Диапазон даты рождения подопечного (YYYY-MM-DD). Формат провалидирует бэкенд
    // (parseDate игнорирует некорректные значения).
    if (birthFrom) fc.birthFrom = birthFrom
    if (birthTo) fc.birthTo = birthTo
    // «Дата выбытия» действует только для «Выбывших» (в UI видна только там) —
    // гейтим и в критериях, чтобы значение не применилось скрыто.
    if (clientStatus === "churned") {
      if (withdrawnFrom) fc.withdrawnFrom = withdrawnFrom
      if (withdrawnTo) fc.withdrawnTo = withdrawnTo
    }
    return fc
  }, [clientStatus, branchId, birthFrom, birthTo, withdrawnFrom, withdrawnTo])

  const preview = useCampaignPreview(open, true, buildFilterCriteria)

  const selectedClientStatus = CLIENT_STATUS_OPTIONS.find(o => o.value === clientStatus)
  const selectedBranch = branches.find(b => b.id === branchId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (!name) { setError("Введите название"); return }
    setLoading(true)
    try {
      const err = await createCampaign(name, buildFilterCriteria())
      if (err) { setError(err); return }
      reset(); setOpen(false); router.refresh()
    } catch { setError("Ошибка сети") } finally { setLoading(false) }
  }

  return (
    // Пока идёт создание, диалог не закрываем: reset() стёр бы форму, а
    // завершившийся in-flight запрос записал бы ошибку в уже закрытый диалог.
    <Dialog open={open} onOpenChange={(v) => { if (!v && loading) return; setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button />}><Database className="mr-2 size-4" />Обзвон по базам</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Новый обзвон по базам</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Обзвон лидов март" />
          </div>

          <div className="space-y-1.5">
            <Label>Статус клиента</Label>
            <Select
              value={clientStatus}
              onValueChange={v => {
                const next = v || ""
                setClientStatus(next)
                // «Дата выбытия» относится только к «Выбывшим»: уходя со статуса,
                // очищаем диапазон, чтобы он не применился скрыто.
                if (next !== "churned") { setWithdrawnFrom(""); setWithdrawnTo("") }
              }}
            >
              <SelectTrigger className="w-full">{selectedClientStatus?.label || "Все"}</SelectTrigger>
              <SelectContent>
                {CLIENT_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Филиал</Label>
              <Select value={branchId} onValueChange={v => setBranchId(v || "")}>
                <SelectTrigger className="w-full">
                  {branchId === NO_BRANCH ? "Без филиала" : (selectedBranch?.name || "Все филиалы")}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Все филиалы</SelectItem>
                  <SelectItem value={NO_BRANCH}>Без филиала</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Дата рождения подопечного</Label>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <span className="block text-xs text-muted-foreground">от</span>
                <Input type="date" value={birthFrom} onChange={e => setBirthFrom(e.target.value)} className="w-full" />
              </div>
              <div className="flex-1 space-y-1">
                <span className="block text-xs text-muted-foreground">до</span>
                <Input type="date" value={birthTo} onChange={e => setBirthTo(e.target.value)} className="w-full" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Подопечный с датой рождения в этом диапазоне (включительно).</p>
          </div>

          {clientStatus === "churned" && (
            <div className="space-y-1.5">
              <Label>Дата выбытия</Label>
              <div className="flex items-center gap-2">
                <Input type="date" value={withdrawnFrom} onChange={e => setWithdrawnFrom(e.target.value)} className="w-full" />
                <span className="text-muted-foreground">—</span>
                <Input type="date" value={withdrawnTo} onChange={e => setWithdrawnTo(e.target.value)} className="w-full" />
              </div>
              <p className="text-xs text-muted-foreground">
                По дате последнего платного занятия. Например: ходил в учебном году, но не летом.
              </p>
            </div>
          )}

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">{previewLabel(preview)}</span>
            <Button type="submit" disabled={loading}>{loading ? "Создание..." : "Создать обзвон"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * «Обзвон по задачам» — только открытые автозадачи выбранных типов, поиск по
 * всей базе, кроме «Архива», «Чёрного списка» и «Нецелевых» (без фильтров базы).
 */
export function CreateTaskCampaignDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [triggers, setTriggers] = useState<Set<string>>(new Set())

  function reset() {
    setName("")
    setTriggers(new Set())
    setError(null)
  }

  function toggleTrigger(t: string) {
    setTriggers((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const buildFilterCriteria = useCallback((): Record<string, unknown> => {
    return { mode: "tasks", autoTriggers: Array.from(triggers) }
  }, [triggers])

  const preview = useCampaignPreview(open, triggers.size > 0, buildFilterCriteria)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (!name) { setError("Введите название"); return }
    if (triggers.size === 0) { setError("Выберите хотя бы один тип задач"); return }
    setLoading(true)
    try {
      const err = await createCampaign(name, buildFilterCriteria())
      if (err) { setError(err); return }
      reset(); setOpen(false); router.refresh()
    } catch { setError("Ошибка сети") } finally { setLoading(false) }
  }

  return (
    // Пока идёт создание, диалог не закрываем (см. CreateCampaignDialog).
    <Dialog open={open} onOpenChange={(v) => { if (!v && loading) return; setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button variant="outline" />}>
        <ListChecks className="mr-2 size-4" />Обзвон по задачам
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Новый обзвон по задачам</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Обзвон по задачам июль" />
          </div>

          <div className="space-y-2">
            <Label>Типы автозадач, включаемых в кампанию</Label>
            <div className="space-y-1.5 rounded-md border p-3">
              {CALL_TRIGGERS.map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer text-sm">
                  <Checkbox
                    checked={triggers.has(t)}
                    onCheckedChange={() => toggleTrigger(t)}
                  />
                  <span>{TRIGGER_LABEL[t]}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              В обзвон попадут клиенты с открытыми автозадачами выбранных типов.
              Поиск по всей базе, кроме «Архива», «Чёрного списка» и «Нецелевых».
            </p>
          </div>

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">
              {triggers.size === 0 ? "Выберите типы задач" : previewLabel(preview)}
            </span>
            <Button type="submit" disabled={loading || triggers.size === 0}>
              {loading ? "Создание..." : "Создать обзвон"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
