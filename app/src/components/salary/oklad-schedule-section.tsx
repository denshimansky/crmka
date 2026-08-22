"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Trash2, CalendarClock } from "lucide-react"
import { useCurrencySymbol } from "@/components/currency-provider"

// История оклада: «с этой даты оклад стал таким». Базовая сумма из карточки —
// версия «с начала»; каждая версия действует только вперёд от своей даты, поэтому
// прошлые месяцы не пересчитываются. «Сняли с оклада» = версия с суммой 0.
//
// В отличие от версий сдельной ставки, дата может быть в прошлом: смысл секции —
// зафиксировать уже случившееся изменение, не переписав закрытые месяцы.

interface OkladVersionRow {
  id: string
  effectiveFrom: string
  amount: number
  comment: string | null
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`
}

export function OkladScheduleSection({
  employeeId,
  baseAmount,
  baseFrom,
  canEdit,
  onChanged,
}: {
  employeeId: string
  /** Базовый оклад из карточки — действует до первой версии. */
  baseAmount: number | null
  /** Дата начала базового оклада (пусто — с начала времён). */
  baseFrom: string | null
  canEdit: boolean
  onChanged?: () => void
}) {
  const sym = useCurrencySymbol()
  const [rows, setRows] = useState<OkladVersionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState("")
  const [amount, setAmount] = useState("")
  const [comment, setComment] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/employees/${employeeId}/oklad-schedule`)
      setRows(res.ok ? await res.json() : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [employeeId])

  useEffect(() => { load() }, [load])

  const fmtMoney = (n: number) => `${new Intl.NumberFormat("ru-RU").format(n)} ${sym}`

  // Что действует сегодня: последняя версия с датой <= сегодня, иначе базовый оклад.
  const todayIso = new Date().toISOString().slice(0, 10)
  const current = [...rows].filter((r) => r.effectiveFrom <= todayIso).pop()
  const currentAmount = current ? current.amount : (baseAmount ?? 0)
  const currentFrom = current ? current.effectiveFrom : baseFrom

  async function save() {
    if (!date) { setError("Укажите дату"); return }
    if (amount.trim() === "") { setError("Укажите сумму (0 — если оклада больше нет)"); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/employees/${employeeId}/oklad-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectiveFrom: date, amount: Number(amount), comment: comment || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось сохранить")
        return
      }
      setAdding(false); setDate(""); setAmount(""); setComment("")
      await load()
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: OkladVersionRow) {
    if (!confirm(`Удалить изменение оклада с ${fmtDate(row.effectiveFrom)}? Месяцы с этой даты снова будут считаться прежней суммой.`)) return
    const res = await fetch(`/api/employees/${employeeId}/oklad-schedule/${row.id}`, { method: "DELETE" })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || "Не удалось удалить")
      return
    }
    await load()
    onChanged?.()
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarClock className="size-4" />
          История оклада
        </div>
        {canEdit && !adding && (
          <Button type="button" variant="outline" size="sm" onClick={() => { setAdding(true); setAmount(String(currentAmount)); setError(null) }}>
            <Plus className="mr-1 size-3.5" /> Изменить с даты
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Сейчас действует: <span className="font-medium text-foreground">{fmtMoney(currentAmount)}</span>
        {currentFrom ? ` (с ${fmtDate(currentFrom)})` : ""}
      </p>

      {error && <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>}

      {adding && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Действует с даты</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Новый оклад, {sym}</Label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0 — оклада больше нет" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Комментарий</Label>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: перевод на сдельную оплату" />
          </div>
          <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Месяцы до этой даты сохранят прежний оклад — задним числом ничего не пересчитается.
            Месяц, на середину которого попадает дата, делится по календарным дням.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={save} disabled={saving}>Сохранить</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(false); setError(null) }}>Отмена</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Изменений оклада нет — действует сумма из поля выше.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded border px-2 py-1 text-sm">
              <span>
                с {fmtDate(r.effectiveFrom)} — <span className="font-medium">{fmtMoney(r.amount)}</span>
                {r.amount === 0 && <span className="ml-1 text-xs text-muted-foreground">(оклада нет)</span>}
                {r.comment && <span className="ml-1 text-xs text-muted-foreground">· {r.comment}</span>}
              </span>
              {canEdit && (
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(r)}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
