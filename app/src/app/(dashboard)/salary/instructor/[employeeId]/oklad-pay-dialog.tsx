"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Banknote } from "lucide-react"
import { useCurrencySymbol } from "@/components/currency-provider"
import { OpiuRecognitionFieldset, type OpiuRecognitionState } from "@/components/opiu-recognition-fieldset"
import { resolveRecognition, type RecognitionPayload } from "@/lib/expense-recognition"
import { applyPenaltyToItems } from "@/lib/salary/kind-split"
import type { InstructorDetailData } from "./instructor-detail-client"

// Тело окладной формы выплаты: сумма + «Как провести в ОПИУ» + корректировки
// (премия/штраф). Оклад проводится ПОЗИЦИЕЙ БЕЗ НАПРАВЛЕНИЯ (directionId=null) —
// так атрибуция относит выплату к вкладке «Оклады»; разнесение оклада по
// направлениям в ОПИУ делает твин-расход по Employee.defaultDirectionId.
// Используется в карточке (OkladPayDialog) и в пуле /salary (PoolOkladPayDialog).
export function OkladPayBody({
  mode, data, onPaid, onCancel,
}: {
  mode: "advance" | "remainder"
  data: InstructorDetailData
  onPaid: () => void
  onCancel: () => void
}) {
  const sym = useCurrencySymbol()
  const fmt = (n: number) => new Intl.NumberFormat("ru-RU").format(Math.round(n * 100) / 100) + " " + sym
  const periodMonthStr = `${data.periodYear}-${String(data.periodMonth).padStart(2, "0")}`

  // Пресет: аванс = половина оклада за вычетом уже выплаченного оклада; остатки =
  // остаток оклада ПЛЮС окладное доначисление прошлых периодов (невыплаченный оклад
  // прошлого месяца; переплата, наоборот, уменьшает сумму). В аванс доначисление не
  // кладём — он считается по текущему месяцу. totals в kind=salary — окладные.
  const priorOklad = data.priorOkladBalance ?? 0
  const preset = mode === "advance"
    ? Math.max(0, Math.round((data.totals.accruedFirstHalf - data.totals.paid) * 100) / 100)
    : Math.max(0, Math.round((data.totals.remaining + priorOklad) * 100) / 100)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "")
  const [amount, setAmount] = useState(String(preset))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [bonus, setBonus] = useState("")
  const [penalty, setPenalty] = useState("")
  const [adjComment, setAdjComment] = useState("")
  const [opiu, setOpiu] = useState<OpiuRecognitionState>({
    recognitionMode: "single_period", singleMonth: periodMonthStr, amortStartMonth: periodMonthStr, amortMonths: "3",
  })

  const amountNum = Number(amount) || 0
  const bonusNum = Number(bonus) || 0
  const penaltyNum = Number(penalty) || 0
  // К выплате = оклад + премия − штраф. Депремирование ВЫЧИТАЕТСЯ из суммы выплаты
  // (не создаёт мнимую переплату), при этом штраф отдельно пишется за период.
  const total = Math.max(0, Math.round((amountNum + bonusNum - penaltyNum) * 100) / 100)

  async function handleSubmit() {
    setError(null)
    if (total <= 0 && penaltyNum <= 0) { setError("Укажите сумму или премию/депремирование"); return }
    if (total > 0 && !accountId) { setError("Выберите счёт"); return }
    if ((bonusNum > 0 || penaltyNum > 0) && !adjComment.trim()) {
      setError("Укажите комментарий к премии/депремированию"); return
    }

    let recognition: RecognitionPayload
    try { recognition = resolveRecognition(opiu) } catch (err) { setError(err instanceof Error ? err.message : "Ошибка признания"); return }

    // Оклад и премия — позициями БЕЗ направления (directionId=null); штраф
    // вычитается из позиций (applyPenaltyToItems) — фактически выплачивается net.
    const gross: { directionId: string | null; amount: number }[] = []
    if (amountNum > 0) gross.push({ directionId: null, amount: amountNum })
    if (bonusNum > 0) gross.push({ directionId: null, amount: bonusNum })
    const items = applyPenaltyToItems(gross, penaltyNum, null)
      .map((it) => ({ employeeId: data.employee.id, accountId, directionId: it.directionId, amount: it.amount }))

    const adjustments: { employeeId: string; directionId: string | null; type: "bonus" | "penalty"; amount: number; comment: string }[] = []
    if (bonusNum > 0) adjustments.push({ employeeId: data.employee.id, directionId: null, type: "bonus", amount: bonusNum, comment: adjComment.trim() })
    if (penaltyNum > 0) adjustments.push({ employeeId: data.employee.id, directionId: null, type: "penalty", amount: penaltyNum, comment: adjComment.trim() })

    setLoading(true)
    try {
      const res = await fetch("/api/salary-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "salary",
          date,
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
          periodHalf: mode === "advance" ? 1 : 2,
          comment: mode === "advance" ? "Аванс (оклад)" : "Остатки оклада",
          items,
          adjustments,
          recognitionMode: recognition.recognitionMode,
          amortizationStartDate: recognition.amortizationStartDate,
          amortizationMonths: recognition.amortizationMonths,
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Сумма (оклад) *</Label>
          <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          <p className="text-xs text-muted-foreground">Остаток оклада: {fmt(Math.max(0, data.totals.remaining))}</p>
        </div>
        <div className="space-y-1.5">
          <Label>Дата *</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Счёт *</Label>
        <Select value={accountId} onValueChange={(v) => { if (v) setAccountId(v) }}>
          <SelectTrigger className="w-full">{selectedAccount ? selectedAccount.name : "Выберите счёт"}</SelectTrigger>
          <SelectContent>
            {data.accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <OpiuRecognitionFieldset value={opiu} onChange={setOpiu} amount={amountNum} sym={sym} />

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
            <Label>Комментарий к премии/депремированию *</Label>
            <Input value={adjComment} onChange={(e) => setAdjComment(e.target.value)} placeholder="За что премия / удержание" />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Премия прибавляется к выплате, депремирование — вычитается: к выплате =
          оклад + премия − штраф{penaltyNum > 0 ? ` (штраф ${fmt(penaltyNum)})` : ""}.
          Штраф отдельно фиксируется в колонке «Штрафы».
        </p>
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

// Окладная выплата из карточки инструктора (фиксированный сотрудник).
export function OkladPayDialog({
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
          <DialogTitle>{title} — {data.employee.name} · Оклад</DialogTitle>
        </DialogHeader>
        {open && (
          <OkladPayBody
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
