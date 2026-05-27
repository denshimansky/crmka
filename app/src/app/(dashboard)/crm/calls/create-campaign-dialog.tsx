"use client"

import { useState } from "react"
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

const FUNNEL_OPTIONS = [
  { value: "", label: "Все статусы" },
  { value: "new", label: "Новые лиды" },
  { value: "trial_scheduled", label: "Пробное записано" },
  { value: "trial_attended", label: "Пробное пройдено" },
  { value: "awaiting_payment", label: "Ожидание оплаты" },
  { value: "active_client", label: "Активные клиенты" },
  { value: "potential", label: "Потенциальные" },
]

const SEGMENT_OPTIONS = [
  { value: "", label: "Все сегменты" },
  { value: "new_client", label: "Новый" },
  { value: "standard", label: "Стандарт" },
  { value: "regular", label: "Постоянный" },
  { value: "vip", label: "VIP" },
]

export function CreateCampaignDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [funnelStatus, setFunnelStatus] = useState("")
  const [segment, setSegment] = useState("")
  const [triggers, setTriggers] = useState<Set<string>>(new Set())

  function reset() {
    setName(""); setFunnelStatus(""); setSegment("")
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

  const selectedFunnel = FUNNEL_OPTIONS.find(o => o.value === funnelStatus)
  const selectedSegment = SEGMENT_OPTIONS.find(o => o.value === segment)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (!name) { setError("Введите название"); return }
    setLoading(true)
    try {
      const filterCriteria: Record<string, unknown> = {}
      if (funnelStatus) filterCriteria.funnelStatus = funnelStatus
      if (segment) filterCriteria.segment = segment
      if (triggers.size > 0) filterCriteria.autoTriggers = Array.from(triggers)

      const res = await fetch("/api/call-campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filterCriteria }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Ошибка"); return }
      reset(); setOpen(false); router.refresh()
    } catch { setError("Ошибка сети") } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button />}><Plus className="mr-2 size-4" />Новый обзвон</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Новая кампания обзвона</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Обзвон лидов март" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Статус клиента</Label>
              <Select value={funnelStatus} onValueChange={v => setFunnelStatus(v || "")}>
                <SelectTrigger className="w-full">{selectedFunnel?.label || "Все статусы"}</SelectTrigger>
                <SelectContent>
                  {FUNNEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
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
              Пусто — отбор только по статусу/сегменту выше.
            </p>
          </div>
          <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Создание..." : "Создать обзвон"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
