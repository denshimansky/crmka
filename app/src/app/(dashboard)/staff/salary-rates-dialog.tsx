"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Pencil, Plus, Trash2, Wallet } from "lucide-react"
import { useCurrencySymbol } from "@/components/currency-provider"
import {
  SalaryRateForm,
  SCHEME_LABELS,
  TRIAL_PAY_LABELS,
  emptyRate,
  type RateFormValue,
  type SchemeKey,
  type TrialPayMode,
} from "@/components/salary/salary-rate-form"
import { RateScheduleSection } from "@/components/salary/rate-schedule-section"

interface RateRow {
  id: string
  scheme: SchemeKey
  directionId: string | null
  direction: { id: string; name: string } | null
  ratePerStudent: string | null
  ratePerLesson: string | null
  fixedPerShift: string | null
  percentOfPayments: string | null
  trialPayMode: string | null
  brackets: { minStudents: number; ratePerLesson: string }[]
}

interface DirectionOption {
  id: string
  name: string
}

function rowToForm(r: RateRow): RateFormValue {
  return {
    scheme: r.scheme,
    ratePerStudent: r.ratePerStudent ? Number(r.ratePerStudent) : null,
    ratePerLesson: r.ratePerLesson ? Number(r.ratePerLesson) : null,
    fixedPerShift: r.fixedPerShift ? Number(r.fixedPerShift) : null,
    percentOfPayments: r.percentOfPayments ? Number(r.percentOfPayments) : null,
    trialPayMode: (r.trialPayMode as TrialPayMode) || "none",
    brackets: r.brackets.map((b) => ({
      minStudents: b.minStudents,
      ratePerLesson: Number(b.ratePerLesson),
    })),
  }
}

function shortSummary(r: RateRow, sym: string): string {
  const parts: string[] = [SCHEME_LABELS[r.scheme]]
  if (r.ratePerStudent) parts.push(`${Number(r.ratePerStudent)}${sym}/уч.`)
  if (r.ratePerLesson) parts.push(`${Number(r.ratePerLesson)}${sym}/зан.`)
  if (r.fixedPerShift) parts.push(`+${Number(r.fixedPerShift)}${sym} фикс`)
  if (r.percentOfPayments) parts.push(`${Number(r.percentOfPayments)}%`)
  if (r.brackets.length) parts.push(`${r.brackets.length} строк`)
  if (r.trialPayMode && r.trialPayMode !== "none") {
    parts.push(`пробные: ${TRIAL_PAY_LABELS[r.trialPayMode as TrialPayMode] ?? r.trialPayMode}`)
  }
  return parts.join(" · ")
}

interface Props {
  employeeId: string
  employeeName: string
  directions: DirectionOption[]
  // Текущий оклад сотрудника (Employee.monthlySalary / defaultDirectionId).
  // Оклад редактируется здесь же, чтобы вся настройка ЗП была в одном месте.
  monthlySalary?: number | null
  defaultDirectionId?: string | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  refreshOnSuccess?: boolean
}

export function SalaryRatesDialog({
  employeeId,
  employeeName,
  directions,
  monthlySalary = null,
  defaultDirectionId = null,
  open: openProp,
  onOpenChange,
  hideTrigger,
  refreshOnSuccess = true,
}: Props) {
  const router = useRouter()
  const sym = useCurrencySymbol()
  const [openInternal, setOpenInternal] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp! : openInternal
  const setOpen = (v: boolean) => {
    if (!isControlled) setOpenInternal(v)
    onOpenChange?.(v)
  }
  const [rates, setRates] = useState<RateRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<RateRow | "new" | null>(null)
  const [editDirectionId, setEditDirectionId] = useState<string>("")
  const [form, setForm] = useState<RateFormValue>(emptyRate())
  const [saving, setSaving] = useState(false)

  // --- Оклад (фиксированная месячная ставка, хранится на Employee) ---
  const [oklad, setOklad] = useState(monthlySalary != null ? String(monthlySalary) : "")
  const [okladDir, setOkladDir] = useState(defaultDirectionId ?? "")
  const [okladSaving, setOkladSaving] = useState(false)
  const [okladSaved, setOkladSaved] = useState(false)
  const [okladError, setOkladError] = useState<string | null>(null)

  // Пересинхронизируем поля оклада с актуальными пропсами при открытии диалога.
  useEffect(() => {
    if (!open) return
    setOklad(monthlySalary != null ? String(monthlySalary) : "")
    setOkladDir(defaultDirectionId ?? "")
    setOkladSaved(false)
    setOkladError(null)
  }, [open, monthlySalary, defaultDirectionId])

  const okladDirty =
    (oklad.trim() === "" ? null : Number(oklad)) !== (monthlySalary ?? null) ||
    (okladDir || null) !== (defaultDirectionId ?? null)

  async function saveOklad() {
    setOkladSaving(true)
    setOkladError(null)
    setOkladSaved(false)
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlySalary: oklad.trim() === "" ? null : Number(oklad),
          defaultDirectionId: okladDir || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setOkladError(data.error || "Не удалось сохранить оклад")
        return
      }
      setOkladSaved(true)
      if (refreshOnSuccess) router.refresh()
    } catch {
      setOkladError("Ошибка сети")
    } finally {
      setOkladSaving(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/employees/${employeeId}/salary-rates`)
      if (res.ok) setRates(await res.json())
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [employeeId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  function openNew() {
    setEditing("new")
    setEditDirectionId("")
    setForm(emptyRate())
    setError(null)
  }
  function openEdit(r: RateRow) {
    setEditing(r)
    setEditDirectionId(r.directionId ?? "")
    setForm(rowToForm(r))
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const body = {
        scheme: form.scheme,
        directionId: editing === "new" ? (editDirectionId || null) : undefined,
        ratePerStudent: form.ratePerStudent,
        ratePerLesson: form.ratePerLesson,
        fixedPerShift: form.fixedPerShift,
        percentOfPayments: form.percentOfPayments,
        trialPayMode: form.trialPayMode,
        brackets: form.brackets,
      }
      const isEdit = editing !== "new" && editing !== null
      const url = isEdit
        ? `/api/salary-rates/${(editing as RateRow).id}`
        : `/api/employees/${employeeId}/salary-rates`
      const method = isEdit ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось сохранить")
        return
      }
      setEditing(null)
      load()
      if (refreshOnSuccess) router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(r: RateRow) {
    const label = r.direction ? `по направлению «${r.direction.name}»` : "по умолчанию"
    if (!confirm(`Удалить ставку ${label}?`)) return
    try {
      const res = await fetch(`/api/salary-rates/${r.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Не удалось удалить")
        return
      }
      load()
      if (refreshOnSuccess) router.refresh()
    } catch {
      /* ignore */
    }
  }

  const defaultRate = rates.find((r) => r.directionId === null)
  const exceptionRates = rates.filter((r) => r.directionId !== null)
  const usedDirectionIds = new Set(rates.map((r) => r.directionId).filter(Boolean) as string[])
  const availableDirections = directions.filter((d) => !usedDirectionIds.has(d.id))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger render={
          <Button variant="ghost" size="icon" className="size-8" title="Ставки ЗП">
            <Wallet className="size-4 text-muted-foreground" />
          </Button>
        } />
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ставки ЗП — {employeeName}</DialogTitle>
          <DialogDescription>
            Оклад — фиксированная месячная сумма. Сдельные ставки начисляются по факту посещений: ставка по умолчанию + исключения по направлениям. Сотрудник может иметь и оклад, и сдельные ставки одновременно.
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {editing === "new" && (
              <div className="space-y-1.5">
                <Label>Направление (исключение)</Label>
                <select
                  value={editDirectionId}
                  onChange={(e) => setEditDirectionId(e.target.value)}
                  className="h-9 w-full rounded border bg-background px-3 text-sm"
                >
                  <option value="">— Ставка по умолчанию —</option>
                  {availableDirections.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}

            <SalaryRateForm value={form} onChange={setForm} />

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Отмена</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Сохранение..." : editing === "new" ? "Создать" : "Сохранить"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {loading ? (
              <div className="text-sm text-muted-foreground">Загрузка...</div>
            ) : (
              <>
                {/* Оклад — фиксированная месячная ставка (для админов и других
                    ролей, а также для педагогов, совмещающих оклад со сделкой). */}
                <div className="space-y-2 rounded-md border p-3">
                  <div className="text-sm font-medium">Оклад</div>
                  <p className="text-xs text-muted-foreground">
                    Фиксированный месячный оклад. Подтягивается в «Документ выплаты ЗП (оклады)»
                    по кнопке «Заполнить». Оставьте пустым, если оклада нет.
                  </p>
                  {okladError && (
                    <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{okladError}</div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Месячный оклад, {sym}</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={oklad}
                        onChange={(e) => { setOklad(e.target.value); setOkladSaved(false) }}
                        placeholder="Нет оклада"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Основное направление</Label>
                      <select
                        value={okladDir}
                        onChange={(e) => { setOkladDir(e.target.value); setOkladSaved(false) }}
                        className="h-9 w-full rounded border bg-background px-3 text-sm"
                      >
                        <option value="">Не выбрано</option>
                        {directions.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Основное направление — для разнесения оклада по направлениям в ОПИУ.
                    Не выбрано — оклад распределяется по всем направлениям пропорционально выручке.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={saveOklad} disabled={okladSaving || !okladDirty}>
                      {okladSaving ? "Сохранение..." : "Сохранить оклад"}
                    </Button>
                    {okladSaved && <span className="text-xs text-green-600">Сохранено</span>}
                  </div>
                </div>

                <div className="pt-1 text-sm font-medium">Сдельные ставки</div>

                <RateBlock
                  title="Ставка по умолчанию"
                  rate={defaultRate}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />

                <div className="space-y-1">
                  <div className="text-sm font-medium">Исключения по направлениям</div>
                  {exceptionRates.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Нет исключений.</div>
                  ) : (
                    exceptionRates.map((r) => (
                      <RateBlock
                        key={r.id}
                        title={r.direction?.name || "—"}
                        rate={r}
                        onEdit={openEdit}
                        onDelete={handleDelete}
                      />
                    ))
                  )}
                </div>

                <Button variant="outline" size="sm" onClick={openNew}>
                  <Plus className="mr-1 size-3" />
                  {defaultRate ? "Добавить исключение" : "Добавить ставку"}
                </Button>

                <DialogFooter>
                  <Button onClick={() => setOpen(false)}>Готово</Button>
                </DialogFooter>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RateBlock({
  title,
  rate,
  onEdit,
  onDelete,
}: {
  title: string
  rate: RateRow | undefined
  onEdit: (r: RateRow) => void
  onDelete: (r: RateRow) => void
}) {
  const sym = useCurrencySymbol()
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{title}</div>
          {rate ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{shortSummary(rate, sym)}</div>
          ) : (
            <div className="mt-0.5 text-xs text-muted-foreground">Не задана</div>
          )}
        </div>
        {rate && (
          <div className="flex items-center gap-0.5">
            <Badge variant="outline" className="text-[10px]">
              {SCHEME_LABELS[rate.scheme]}
            </Badge>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(rate)}>
              <Pencil className="size-3.5 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onDelete(rate)}>
              <Trash2 className="size-3.5 text-muted-foreground" />
            </Button>
          </div>
        )}
      </div>
      {rate && <RateScheduleSection rateId={rate.id} currentValue={rowToForm(rate)} />}
    </div>
  )
}
