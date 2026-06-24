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
import { Plus } from "lucide-react"
import { MANAGED_TRIGGERS, TRIGGER_LABEL } from "@/lib/tasks/trigger-settings"

// Этап воронки: новые/активные/потенциальные — статусы контакта (Client.funnelStatus),
// заявка/пробное/прошёл пробное/ожидание оплаты — стадии подопечного (Ward.salesStage).
// API сам определяет, по какому полю фильтровать.
const FUNNEL_OPTIONS = [
  { value: "", label: "Все этапы" },
  { value: "new", label: "Новые лиды" },
  { value: "application", label: "Заявка" },
  { value: "trial_scheduled", label: "Пробное записано" },
  { value: "trial_attended", label: "Пробное пройдено" },
  { value: "awaiting_payment", label: "Ожидание оплаты" },
  { value: "active_client", label: "Активные клиенты" },
  { value: "potential", label: "Потенциальные" },
]

// Рабочий статус клиента (Client.clientStatus) — отдельно от этапа воронки.
// «Не активный» = выбывший или в архиве (аналог графы из 1С).
const CLIENT_STATUS_OPTIONS = [
  { value: "", label: "Любой" },
  { value: "active", label: "Активный" },
  { value: "churned", label: "Выбывший" },
  { value: "archived", label: "Архив" },
  { value: "not_active", label: "Не активный (выбывший/архив)" },
]

const SEGMENT_OPTIONS = [
  { value: "", label: "Все сегменты" },
  { value: "new_client", label: "Новый" },
  { value: "standard", label: "Стандарт" },
  { value: "regular", label: "Постоянный" },
  { value: "vip", label: "VIP" },
]

interface BranchOption {
  id: string
  name: string
}

export function CreateCampaignDialog({ branches }: { branches: BranchOption[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [funnelStatus, setFunnelStatus] = useState("")
  const [clientStatus, setClientStatus] = useState("")
  const [segment, setSegment] = useState("")
  const [branchId, setBranchId] = useState("")
  const [minAge, setMinAge] = useState("")
  const [maxAge, setMaxAge] = useState("")
  const [withdrawnFrom, setWithdrawnFrom] = useState("")
  const [withdrawnTo, setWithdrawnTo] = useState("")
  const [lastContactFrom, setLastContactFrom] = useState("")
  const [lastContactTo, setLastContactTo] = useState("")
  const [triggers, setTriggers] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ count: number; exceeded: boolean } | "error" | null>(null)

  function reset() {
    setName(""); setFunnelStatus(""); setClientStatus(""); setSegment(""); setBranchId("")
    setMinAge(""); setMaxAge("")
    setWithdrawnFrom(""); setWithdrawnTo("")
    setLastContactFrom(""); setLastContactTo("")
    setTriggers(new Set())
    setError(null)
    setPreview(null)
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
    const fc: Record<string, unknown> = {}
    if (funnelStatus) fc.funnelStatus = funnelStatus
    if (clientStatus) fc.clientStatus = clientStatus
    if (segment) fc.segment = segment
    if (branchId) fc.branchId = branchId
    // Кламп 0..120 — чтобы и предпросмотр, и создание не падали на zod-валидации.
    if (minAge !== "" && !Number.isNaN(Number(minAge))) fc.minAge = Math.min(120, Math.max(0, Math.trunc(Number(minAge))))
    if (maxAge !== "" && !Number.isNaN(Number(maxAge))) fc.maxAge = Math.min(120, Math.max(0, Math.trunc(Number(maxAge))))
    if (withdrawnFrom) fc.withdrawnFrom = withdrawnFrom
    if (withdrawnTo) fc.withdrawnTo = withdrawnTo
    if (lastContactFrom) fc.lastContactFrom = lastContactFrom
    if (lastContactTo) fc.lastContactTo = lastContactTo
    if (triggers.size > 0) fc.autoTriggers = Array.from(triggers)
    return fc
  }, [funnelStatus, clientStatus, segment, branchId, minAge, maxAge,
    withdrawnFrom, withdrawnTo, lastContactFrom, lastContactTo, triggers])

  // Live-предпросмотр размера выборки (debounce). Считается, пока открыт диалог.
  useEffect(() => {
    if (!open) return
    const fc = buildFilterCriteria()
    let cancelled = false
    const handle = setTimeout(() => {
      fetch("/api/call-campaigns/preview", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filterCriteria: fc }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("preview failed"))))
        .then((d) => { if (!cancelled) setPreview({ count: d.count, exceeded: !!d.exceeded }) })
        .catch(() => { if (!cancelled) setPreview("error") })
    }, 400)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [open, buildFilterCriteria])

  const selectedFunnel = FUNNEL_OPTIONS.find(o => o.value === funnelStatus)
  const selectedClientStatus = CLIENT_STATUS_OPTIONS.find(o => o.value === clientStatus)
  const selectedSegment = SEGMENT_OPTIONS.find(o => o.value === segment)
  const selectedBranch = branches.find(b => b.id === branchId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (!name) { setError("Введите название"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/call-campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filterCriteria: buildFilterCriteria() }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Ошибка"); return }
      reset(); setOpen(false); router.refresh()
    } catch { setError("Ошибка сети") } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button />}><Plus className="mr-2 size-4" />Новый обзвон</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Новая кампания обзвона</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Обзвон лидов март" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Этап воронки</Label>
              <Select value={funnelStatus} onValueChange={v => setFunnelStatus(v || "")}>
                <SelectTrigger className="w-full">{selectedFunnel?.label || "Все этапы"}</SelectTrigger>
                <SelectContent>
                  {FUNNEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Статус клиента</Label>
              <Select value={clientStatus} onValueChange={v => setClientStatus(v || "")}>
                <SelectTrigger className="w-full">{selectedClientStatus?.label || "Любой"}</SelectTrigger>
                <SelectContent>
                  {CLIENT_STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Филиал</Label>
              <Select value={branchId} onValueChange={v => setBranchId(v || "")}>
                <SelectTrigger className="w-full">{selectedBranch?.name || "Все филиалы"}</SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Все филиалы</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Куда ходил (выбывший) или записывался/пробное (потенциальный).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Сегмент</Label>
              <Select value={segment} onValueChange={v => setSegment(v || "")}>
                <SelectTrigger className="w-full">{selectedSegment?.label || "Все сегменты"}</SelectTrigger>
                <SelectContent>
                  {SEGMENT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Возраст подопечного, лет</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number" min={0} max={120} inputMode="numeric"
                value={minAge} onChange={e => setMinAge(e.target.value)}
                placeholder="от" className="w-24"
              />
              <span className="text-muted-foreground">—</span>
              <Input
                type="number" min={0} max={120} inputMode="numeric"
                value={maxAge} onChange={e => setMaxAge(e.target.value)}
                placeholder="до" className="w-24"
              />
            </div>
          </div>

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

          <div className="space-y-1.5">
            <Label>Последняя связь</Label>
            <div className="flex items-center gap-2">
              <Input type="date" value={lastContactFrom} onChange={e => setLastContactFrom(e.target.value)} className="w-full" />
              <span className="text-muted-foreground">—</span>
              <Input type="date" value={lastContactTo} onChange={e => setLastContactTo(e.target.value)} className="w-full" />
            </div>
            <p className="text-xs text-muted-foreground">
              Последний контакт попадает в этот период (чтобы не обрабатывать совсем старых).
            </p>
          </div>

          <div className="space-y-2">
            <Label>Типы автозадач, включаемых в кампанию</Label>
            <div className="space-y-1.5 rounded-md border p-3">
              {MANAGED_TRIGGERS.map((t) => (
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
              Если выбраны — в обзвон попадут клиенты с открытыми автозадачами выбранных типов.
              Пусто — отбор только по фильтрам выше.
            </p>
          </div>

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">
              {preview === "error"
                ? "Не удалось оценить выборку"
                : preview
                  ? `Найдено: ${preview.count}${preview.exceeded ? "+ (макс. 500)" : ""} клиентов`
                  : "Подбор выборки…"}
            </span>
            <Button type="submit" disabled={loading}>{loading ? "Создание..." : "Создать обзвон"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
