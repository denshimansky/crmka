"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, Plus, Trash2, CalendarClock } from "lucide-react"
import { useCurrencySymbol } from "@/components/currency-provider"
import {
  SalaryRateForm,
  SCHEME_LABELS,
  type RateFormValue,
  type SchemeKey,
  type TrialPayMode,
} from "@/components/salary/salary-rate-form"

interface ScheduleRow {
  id: string
  effectiveFrom: string
  scheme: SchemeKey
  ratePerStudent: string | null
  ratePerLesson: string | null
  fixedPerShift: string | null
  percentOfPayments: string | null
  trialPayMode: string | null
  brackets: { minStudents: number; ratePerLesson: string }[]
}

function rowToForm(r: ScheduleRow): RateFormValue {
  return {
    scheme: r.scheme,
    ratePerStudent: r.ratePerStudent ? Number(r.ratePerStudent) : null,
    ratePerLesson: r.ratePerLesson ? Number(r.ratePerLesson) : null,
    fixedPerShift: r.fixedPerShift ? Number(r.fixedPerShift) : null,
    percentOfPayments: r.percentOfPayments ? Number(r.percentOfPayments) : null,
    trialPayMode: (r.trialPayMode as TrialPayMode) || "none",
    brackets: r.brackets.map((b) => ({ minStudents: b.minStudents, ratePerLesson: Number(b.ratePerLesson) })),
  }
}

function summary(f: RateFormValue, sym: string): string {
  const p: string[] = [SCHEME_LABELS[f.scheme]]
  if (f.ratePerStudent) p.push(`${f.ratePerStudent}${sym}/уч.`)
  if (f.ratePerLesson) p.push(`${f.ratePerLesson}${sym}/зан.`)
  if (f.fixedPerShift) p.push(`+${f.fixedPerShift}${sym} фикс`)
  if (f.percentOfPayments) p.push(`${f.percentOfPayments}%`)
  if (f.brackets.length) p.push(`${f.brackets.length} строк`)
  return p.join(" · ")
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`
}

interface Props {
  rateId: string
  currentValue: RateFormValue
}

export function RateScheduleSection({ rateId, currentValue }: Props) {
  const sym = useCurrencySymbol()
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<ScheduleRow | "new" | null>(null)
  const [date, setDate] = useState("")
  const [form, setForm] = useState<RateFormValue>(currentValue)
  const [impact, setImpact] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/salary-rates/${rateId}/schedule`)
      if (res.ok) setRows(await res.json())
    } finally {
      setLoading(false)
    }
  }, [rateId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!date) {
      setImpact(null)
      return
    }
    let alive = true
    fetch(`/api/salary-rates/${rateId}/schedule/impact?from=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setImpact(d.count)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [date, rateId])

  function openNew() {
    setEditing("new")
    setDate("")
    setForm(currentValue)
    setImpact(null)
    setError(null)
  }
  function openEdit(r: ScheduleRow) {
    setEditing(r)
    setDate(r.effectiveFrom.slice(0, 10))
    setForm(rowToForm(r))
    setError(null)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        effectiveFrom: date,
        scheme: form.scheme,
        ratePerStudent: form.ratePerStudent,
        ratePerLesson: form.ratePerLesson,
        fixedPerShift: form.fixedPerShift,
        percentOfPayments: form.percentOfPayments,
        trialPayMode: form.trialPayMode,
        brackets: form.brackets,
      }
      const isEdit = editing !== "new" && editing !== null
      const url = isEdit
        ? `/api/salary-rates/${rateId}/schedule/${(editing as ScheduleRow).id}`
        : `/api/salary-rates/${rateId}/schedule`
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось сохранить")
        return
      }
      setEditing(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function remove(r: ScheduleRow) {
    if (!confirm(`Удалить запланированное изменение с ${fmtDate(r.effectiveFrom)}?`)) return
    const res = await fetch(`/api/salary-rates/${rateId}/schedule/${r.id}`, { method: "DELETE" })
    if (res.ok) load()
  }

  // Действующая сейчас версия (прошедшая) — база может быть не равна текущей ставке.
  const now = new Date()
  const activeNow = rows
    .filter((r) => new Date(r.effectiveFrom) <= now)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0]

  return (
    <div className="mt-2 border-t pt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <CalendarClock className="size-3.5" /> Запланированные изменения ставки
        </div>
        {!editing && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={openNew}>
            <Plus className="mr-1 size-3" /> С даты
          </Button>
        )}
      </div>

      {activeNow && !editing && (
        <div className="mt-1 text-xs text-muted-foreground">
          Сейчас действует: {summary(rowToForm(activeNow), sym)} (с {fmtDate(activeNow.effectiveFrom)})
        </div>
      )}

      {editing ? (
        <div className="mt-2 space-y-3 rounded-md bg-muted/30 p-3">
          {error && <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label className="text-xs">Действует с даты</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8" />
          </div>
          <SalaryRateForm value={form} onChange={setForm} />
          <div className="rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Уже проведённые занятия пересчитываются по ставке своего периода.
            {date && impact !== null && ` С ${fmtDate(date)} новая ставка затронет ≈ ${impact} будущих занятий инструктора.`}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
              Отмена
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={saving || !date}>
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      ) : loading ? (
        <div className="mt-1 text-xs text-muted-foreground">Загрузка…</div>
      ) : rows.length === 0 ? (
        <div className="mt-1 text-xs text-muted-foreground">Нет запланированных изменений.</div>
      ) : (
        <div className="mt-1 space-y-1">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
              <span>
                <span className="font-medium">с {fmtDate(r.effectiveFrom)}</span>
                {" — "}
                <span className="text-muted-foreground">{summary(rowToForm(r), sym)}</span>
              </span>
              <span className="flex items-center gap-0.5">
                <Button type="button" variant="ghost" size="icon" className="size-6" onClick={() => openEdit(r)}>
                  <Pencil className="size-3 text-muted-foreground" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-6" onClick={() => remove(r)}>
                  <Trash2 className="size-3 text-muted-foreground" />
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
