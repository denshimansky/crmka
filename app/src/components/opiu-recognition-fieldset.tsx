"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RecognitionMode } from "@/lib/expense-recognition"

const MONTH_NAMES = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
]
function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m || m < 1 || m > 12) return yyyymm
  return `${MONTH_NAMES[m - 1]} ${y}`
}
function shiftMonth(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m) return yyyymm
  const k = y * 12 + (m - 1) + delta
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`
}
function fmtNum(amount: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount)
}

export interface OpiuRecognitionState {
  recognitionMode: RecognitionMode
  singleMonth: string
  amortStartMonth: string
  amortMonths: string
}

export function OpiuRecognitionFieldset({
  value,
  onChange,
  amount,
  sym,
}: {
  value: OpiuRecognitionState
  onChange: (next: OpiuRecognitionState) => void
  amount: number
  sym: string
}) {
  const set = (patch: Partial<OpiuRecognitionState>) => onChange({ ...value, ...patch })
  const amortN = Math.max(2, Math.min(60, Number(value.amortMonths) || 0))
  const amortPerMonth = amount > 0 && amortN > 0 ? amount / amortN : 0
  const amortEndMonth = shiftMonth(value.amortStartMonth, amortN - 1)

  return (
    <fieldset className="space-y-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">Как провести в ОПИУ</legend>
      <p className="text-xs text-muted-foreground">
        В ДДС расход всегда учитывается по дате платежа. В ОПИУ — по периоду признания.
      </p>

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="recognition-mode" className="mt-1"
          checked={value.recognitionMode === "by_payment_date"}
          onChange={() => set({ recognitionMode: "by_payment_date" })} />
        <span>
          <span className="font-medium">Одной суммой по дате платежа</span>
          <span className="block text-xs text-muted-foreground">ОПИУ и ДДС совпадают: расход относится к месяцу даты выше.</span>
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="recognition-mode" className="mt-1"
          checked={value.recognitionMode === "single_period"}
          onChange={() => set({ recognitionMode: "single_period" })} />
        <span className="flex-1">
          <span className="font-medium">Одной суммой в другом месяце</span>
          <span className="block text-xs text-muted-foreground">Например, ЗП июля выплачена 1 августа → ОПИУ июль.</span>
          {value.recognitionMode === "single_period" && (
            <div className="mt-2 space-y-1.5">
              <Label className="text-xs">Месяц признания</Label>
              <Input type="month" value={value.singleMonth} onChange={(e) => set({ singleMonth: e.target.value })} />
            </div>
          )}
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="recognition-mode" className="mt-1"
          checked={value.recognitionMode === "amortized"}
          onChange={() => set({ recognitionMode: "amortized" })} />
        <span className="flex-1">
          <span className="font-medium">Разделить на N месяцев</span>
          <span className="block text-xs text-muted-foreground">Например, годовой бонус разбить по месяцам.</span>
          {value.recognitionMode === "amortized" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Начиная с</Label>
                <Input type="month" value={value.amortStartMonth} onChange={(e) => set({ amortStartMonth: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Месяцев</Label>
                <Input type="number" min="2" max="60" value={value.amortMonths} onChange={(e) => set({ amortMonths: e.target.value })} />
              </div>
              {amortPerMonth > 0 && (
                <p className="col-span-2 text-xs text-muted-foreground">
                  {formatMonth(value.amortStartMonth)} — {formatMonth(amortEndMonth)} (по {fmtNum(amortPerMonth)} {sym}/мес)
                </p>
              )}
            </div>
          )}
        </span>
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="recognition-mode" className="mt-1"
          checked={value.recognitionMode === "not_in_pnl"}
          onChange={() => set({ recognitionMode: "not_in_pnl" })} />
        <span>
          <span className="font-medium">Не учитывать в финрезе</span>
          <span className="block text-xs text-muted-foreground">Только ДДС: расход уменьшит остаток на счёте, но не попадёт в ОПИУ.</span>
        </span>
      </label>
    </fieldset>
  )
}
