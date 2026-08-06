"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Banknote } from "lucide-react"
import { useCurrencySymbol } from "@/components/currency-provider"
import { capPresetsToBudget } from "@/lib/salary/allocate-payments"
import type { InstructorDetailData } from "./instructor-detail-client"

const NO_DIR = "__no_direction__"

interface Row {
  key: string
  directionId: string | null
  name: string
  remaining: number   // остаток (для предупреждения о переплате)
  preset: number      // пресет суммы по режиму
  checked: boolean
  amount: string
}

// Пресеты строк по режиму (аванс «до 15-го» / остатки). Осиротевшие строки
// (accrued=0, remaining<0 — переплата по направлению без начислений в периоде)
// в модалку не выносим. В режиме «остатки» суммарный пресет ограничивается общим
// остатком сотрудника (иначе депремирование/переплата завышают «Итого»).
function buildRows(data: InstructorDetailData, mode: "advance" | "remainder"): Row[] {
  const dirRows: Row[] = data.byDirection
    .filter((d) => !(d.accrued === 0 && d.remaining < 0))
    .map((d) => {
      const preset = mode === "advance"
        ? Math.max(0, d.accruedFirstHalf - d.paid)
        : Math.max(0, d.remaining)
      return {
        key: d.directionId ?? NO_DIR,
        directionId: d.directionId,
        name: d.directionName,
        remaining: d.remaining,
        preset: Math.round(preset * 100) / 100,
        checked: preset > 0,
        amount: String(Math.round(preset * 100) / 100),
      }
    })
  // Строка «Премии − штрафы» (без направления) — только у чистого сдельщика
  // (у совместителя ненаправленные премии — окладные, на этой вкладке их нет).
  if (data.adjustments.net !== 0) {
    const preset = mode === "remainder" ? Math.max(0, data.adjustments.remaining) : 0
    dirRows.push({
      key: "__adjustments__",
      directionId: null,
      name: "Премии − штрафы",
      remaining: data.adjustments.remaining,
      preset: Math.round(preset * 100) / 100,
      checked: preset > 0,
      amount: String(Math.round(preset * 100) / 100),
    })
  }
  if (mode === "remainder") {
    const capped = capPresetsToBudget(dirRows.map((r) => r.preset), data.totals.remaining)
    dirRows.forEach((r, i) => {
      r.preset = capped[i]
      r.amount = String(capped[i])
      r.checked = capped[i] > 0
    })
  }
  return dirRows
}

// Тело сделочной формы выплаты (без окладной части). Используется и в карточке
// (PayByDirectionDialog), и в пуле /salary (PoolPiecePayDialog) — единая денежная
// логика. Монтируется заново при каждом открытии диалога (сброс состояния из data).
export function PiecePayBody({
  mode, data, onPaid, onCancel,
}: {
  mode: "advance" | "remainder"
  data: InstructorDetailData
  onPaid: () => void
  onCancel: () => void
}) {
  const sym = useCurrencySymbol()
  const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n * 100) / 100) + " " + sym
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<Row[]>(() => buildRows(data, mode))
  // Премия (+) выплачивается в этой же выплате и записывается за период.
  // Депремирование (−) только записывается и уменьшает «Осталось» — не выплачивается.
  const [bonus, setBonus] = useState("")
  const [penalty, setPenalty] = useState("")
  // Сдельная премия/штраф привязывается к НАПРАВЛЕНИЮ (вместо комментария): так она
  // относится к вкладке «Сделка» и распределяется в ОПИУ по направлению.
  const [premiumDirectionId, setPremiumDirectionId] = useState("")
  const [directions, setDirections] = useState<{ id: string; name: string }[]>([])

  // Направления центра для селекта премии/депремирования.
  useEffect(() => {
    fetch("/api/directions").then((r) => (r.ok ? r.json() : [])).then((d: unknown) => {
      const list = Array.isArray(d) ? d : Array.isArray((d as { data?: unknown })?.data) ? (d as { data: unknown[] }).data : []
      setDirections((list as { id: string; name: string }[]).map((x) => ({ id: x.id, name: x.name })))
    }).catch(() => { /* ignore */ })
  }, [])

  function setRowAmount(key: string, value: string) {
    setRows((prev) => prev.map((r) => r.key === key ? { ...r, amount: value } : r))
  }
  function toggleRow(key: string) {
    setRows((prev) => prev.map((r) => r.key === key ? { ...r, checked: !r.checked } : r))
  }

  const rowsTotal = useMemo(
    () => rows.filter((r) => r.checked).reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [rows],
  )
  const bonusNum = Number(bonus) || 0
  const penaltyNum = Number(penalty) || 0
  // Итого к выплате = выбранные направления + премия (выплачивается сейчас).
  // Депремирование в выплату НЕ входит — это удержание (уменьшает «Осталось»).
  const total = rowsTotal + bonusNum
  const overpay = rows.some((r) => r.checked && (Number(r.amount) || 0) > r.remaining + 0.001)

  async function handleSubmit() {
    setError(null)
    const items: { employeeId: string; accountId: string; directionId: string | null; amount: number }[] = rows
      .filter((r) => r.checked && Number(r.amount) > 0)
      .map((r) => ({ employeeId: data.employee.id, accountId, directionId: r.directionId, amount: Number(r.amount) }))
    const premiumDir = premiumDirectionId || null
    // Премия выплачивается сейчас → строка выплаты по направлению премии (сделка).
    if (bonusNum > 0) {
      items.push({ employeeId: data.employee.id, accountId, directionId: premiumDir, amount: bonusNum })
    }
    // Премия/штраф записываются как SalaryAdjustment за период (атомарно с выплатой),
    // с directionId — так они относятся к сделке и попадают в нужное направление.
    const adjustments: { employeeId: string; directionId: string | null; type: "bonus" | "penalty"; amount: number }[] = []
    if (bonusNum > 0) adjustments.push({ employeeId: data.employee.id, directionId: premiumDir, type: "bonus", amount: bonusNum })
    if (penaltyNum > 0) adjustments.push({ employeeId: data.employee.id, directionId: premiumDir, type: "penalty", amount: penaltyNum })

    if (items.length === 0 && adjustments.length === 0) {
      setError("Отметьте направление с суммой или укажите премию/депремирование"); return
    }
    if (items.length > 0 && !accountId) { setError("Выберите счёт"); return }
    if ((bonusNum > 0 || penaltyNum > 0) && !premiumDir) {
      setError("Выберите направление премии/депремирования"); return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/salary-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "piece",
          date,
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
          periodHalf: mode === "advance" ? 1 : 2,
          comment: mode === "advance" ? "Аванс" : "Остатки ЗП",
          items,
          adjustments,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Ошибка при выплате")
        return
      }
      onPaid()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedAccount = data.accounts.find((a) => a.id === accountId)

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет начислений за период.</p>
      ) : (
        <div className="rounded-md border divide-y">
          {rows.map((r) => {
            const over = r.checked && (Number(r.amount) || 0) > r.remaining + 0.001
            return (
              <div key={r.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" checked={r.checked} onChange={() => toggleRow(r.key)} className="size-4" />
                <span className="flex-1">{r.name}</span>
                <span className="text-xs text-muted-foreground">ост. {fmt(r.remaining)}</span>
                <Input
                  type="number" step="0.01" min="0"
                  value={r.amount}
                  onChange={(e) => setRowAmount(r.key, e.target.value)}
                  disabled={!r.checked}
                  className={`w-28 text-right ${over ? "border-orange-400" : ""}`}
                />
              </div>
            )
          })}
        </div>
      )}

      {overpay && (
        <p className="text-xs text-orange-600">Внимание: по некоторым строкам сумма больше остатка (аванс/переплата).</p>
      )}

      <div className="rounded-md border p-3 space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-green-700">Премия (+)</Label>
            <Input type="number" step="0.01" min="0" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-red-700">Депремирование (−)</Label>
            <Input type="number" step="0.01" min="0" value={penalty} onChange={(e) => setPenalty(e.target.value)} placeholder="0" />
          </div>
        </div>
        {(bonusNum > 0 || penaltyNum > 0) && (
          <div className="space-y-1.5">
            <Label>Направление премии/депремирования *</Label>
            <Select value={premiumDirectionId} onValueChange={(v) => { if (v) setPremiumDirectionId(v) }}>
              <SelectTrigger className="w-full">
                {directions.find((d) => d.id === premiumDirectionId)?.name ?? "Выберите направление"}
              </SelectTrigger>
              <SelectContent>
                {directions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Премия выплачивается в этой выплате и записывается за период. Депремирование
          не выплачивается — только уменьшает «Осталось» сотрудника
          {penaltyNum > 0 ? ` на ${fmt(penaltyNum)}` : ""}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Счёт *</Label>
          <Select value={accountId} onValueChange={(v) => { if (v) setAccountId(v) }}>
            <SelectTrigger className="w-full">{selectedAccount ? selectedAccount.name : "Выберите счёт"}</SelectTrigger>
            <SelectContent>
              {data.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Дата *</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center justify-between text-base font-bold">
        <span>Итого к выплате:</span>
        <span>{fmt(total)}</span>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={loading}>Отмена</Button>
        <Button onClick={handleSubmit} disabled={loading || (total <= 0 && penaltyNum <= 0)}>
          {loading ? "Сохранение…" : total > 0 ? `Выплатить ${fmt(total)}` : "Сохранить"}
        </Button>
      </DialogFooter>
    </div>
  )
}

// Сделочная выплата из карточки инструктора (фиксированный сотрудник).
export function PayByDirectionDialog({
  mode, data, onPaid,
}: {
  mode: "advance" | "remainder"
  data: InstructorDetailData
  onPaid: () => void
}) {
  const [open, setOpen] = useState(false)
  const title = mode === "advance" ? "Выплатить аванс" : "Выплатить остатки"
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={mode === "advance" ? "outline" : "default"} disabled={data.periodLocked} />}>
        <Banknote className="mr-2 size-4" />
        {title}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title} — {data.employee.name}</DialogTitle>
        </DialogHeader>
        {open && (
          <PiecePayBody
            mode={mode}
            data={data}
            onCancel={() => setOpen(false)}
            onPaid={() => { setOpen(false); onPaid() }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
