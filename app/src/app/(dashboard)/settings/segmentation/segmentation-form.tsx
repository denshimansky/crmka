"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Save, Trash2 } from "lucide-react"
import {
  MODE_LABELS,
  type SegmentationConfig,
  type SegmentationMode,
} from "@/lib/segmentation"

type Result = { type: "success" | "error"; message: string } | null

export function SegmentationForm({
  initial,
}: {
  initial: SegmentationConfig | null
}) {
  const router = useRouter()
  const [mode, setMode] = useState<SegmentationMode>(initial?.mode ?? "amount")
  const [standard, setStandard] = useState(
    initial ? String(initial.thresholds.standard) : "",
  )
  const [regular, setRegular] = useState(
    initial ? String(initial.thresholds.regular) : "",
  )
  const [vip, setVip] = useState(initial ? String(initial.thresholds.vip) : "")
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<Result>(null)

  // Юнит метрики в подсказке: «₽» для суммы, «мес.» для времени.
  const unit = mode === "amount" ? "₽" : "мес."

  async function handleSave() {
    const s = Number(standard)
    const r = Number(regular)
    const v = Number(vip)
    if (![s, r, v].every((x) => Number.isFinite(x) && x >= 0)) {
      setResult({ type: "error", message: "Введите числа ≥ 0" })
      return
    }
    if (!(s < r && r < v)) {
      setResult({
        type: "error",
        message: "Пороги должны строго возрастать: Стандартный < Постоянный < VIP",
      })
      return
    }
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch("/api/organization/segmentation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          thresholds: { standard: s, regular: r, vip: v },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setResult({ type: "error", message: data.error || "Ошибка сохранения" })
        return
      }
      setResult({ type: "success", message: "Сохранено" })
      router.refresh()
    } catch {
      setResult({ type: "error", message: "Ошибка сети" })
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!confirm("Сбросить сегментацию? У всех клиентов будет показан «Новый».")) {
      return
    }
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch("/api/organization/segmentation", {
        method: "DELETE",
      })
      if (!res.ok) {
        setResult({ type: "error", message: "Не удалось сбросить" })
        return
      }
      setMode("amount")
      setStandard("")
      setRegular("")
      setVip("")
      setResult({ type: "success", message: "Сегментация сброшена" })
      router.refresh()
    } catch {
      setResult({ type: "error", message: "Ошибка сети" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Сегментировать по</Label>
        <Select value={mode} onValueChange={(v) => v && setMode(v as SegmentationMode)}>
          <SelectTrigger className="w-full sm:max-w-md">
            {MODE_LABELS[mode]}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="amount">{MODE_LABELS.amount}</SelectItem>
            <SelectItem value="months">{MODE_LABELS.months}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          «По сумме» считает реально отработанную выручку клиента (сумма списаний
          с абонементов за посещённые занятия). «По времени» — сколько полных
          месяцев прошло с даты первой оплаты клиента.
        </p>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-[140px_1fr_120px] items-center gap-3 text-sm">
          <div className="text-muted-foreground">Сегмент</div>
          <div className="text-muted-foreground">Порог</div>
          <div />
        </div>

        <SegmentRow label="Новый" hint="Всё, что ниже порога «Стандартный»" />

        <SegmentRow
          label="Стандартный"
          input={
            <ThresholdInput
              value={standard}
              onChange={setStandard}
              unit={unit}
              placeholder={mode === "amount" ? "напр. 50000" : "напр. 1"}
            />
          }
          hint={`≥ значения «Стандартный» — ${unit}`}
        />

        <SegmentRow
          label="Постоянный"
          input={
            <ThresholdInput
              value={regular}
              onChange={setRegular}
              unit={unit}
              placeholder={mode === "amount" ? "напр. 200000" : "напр. 6"}
            />
          }
          hint={`≥ значения «Постоянный» — ${unit}`}
        />

        <SegmentRow
          label="VIP"
          input={
            <ThresholdInput
              value={vip}
              onChange={setVip}
              unit={unit}
              placeholder={mode === "amount" ? "напр. 500000" : "напр. 12"}
            />
          }
          hint={`≥ значения «VIP» — ${unit}`}
        />
      </div>

      {result && (
        <div
          className={`rounded-md p-3 text-sm ${
            result.type === "success"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {result.message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {initial && (
          <Button variant="outline" onClick={handleReset} disabled={saving}>
            <Trash2 className="mr-2 size-4" />
            Сбросить
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-2 size-4" />
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
    </div>
  )
}

function SegmentRow({
  label,
  input,
  hint,
}: {
  label: string
  input?: React.ReactNode
  hint?: string
}) {
  return (
    <div className="grid grid-cols-[140px_1fr_120px] items-center gap-3 rounded-md border p-3 text-sm">
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground">{input ?? hint}</div>
      <div className="text-right text-xs text-muted-foreground">
        {input ? hint : null}
      </div>
    </div>
  )
}

function ThresholdInput({
  value,
  onChange,
  unit,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  unit: string
  placeholder?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min="0"
        step={unit === "₽" ? "1" : "0.5"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="max-w-[200px]"
      />
      <span className="text-xs text-muted-foreground shrink-0">{unit}</span>
    </div>
  )
}
