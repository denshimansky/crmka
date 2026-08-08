"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Trash2 } from "lucide-react"
import { useCurrencySymbol } from "@/components/currency-provider"

export type SchemeKey =
  | "per_student"
  | "per_lesson"
  | "fixed_plus_per_student"
  | "percent_of_payments"
  | "floating_by_students"

export const SCHEME_LABELS: Record<SchemeKey, string> = {
  per_student: "За ученика",
  per_lesson: "Фикс за занятие",
  fixed_plus_per_student: "Фикс за выход + за ученика",
  percent_of_payments: "% от списаний за занятие",
  floating_by_students: "Плавающая (по числу учеников)",
}

export type TrialPayMode = "none" | "paid_only" | "all"

// Значение поля «Оплата за пробное» в форме. У ставки группы допустим ещё
// "inherit" — «По ставке инструктора» (в БД GroupSalaryRate.trialPayMode = NULL).
// Личные ставки inherit не используют.
export type TrialPayFormValue = TrialPayMode | "inherit"

export const TRIAL_PAY_LABELS: Record<TrialPayMode, string> = {
  none: "Не платить",
  paid_only: "Только платные",
  all: "Все пробные",
}

const TRIAL_PAY_HINTS: Record<TrialPayMode, string> = {
  none: "ЗП за пробные не начисляется",
  paid_only: "Начисляется, если у направления задана цена пробного",
  all: "Начисляется за любое пробное, включая бесплатные",
}

const TRIAL_INHERIT_LABEL = "По ставке инструктора"
const TRIAL_INHERIT_HINT =
  "За пробные берётся личная настройка инструктора, ведущего занятие"

export interface Bracket {
  minStudents: number
  ratePerLesson: number
}

export interface RateFormValue {
  scheme: SchemeKey
  ratePerStudent: number | null
  ratePerLesson: number | null
  fixedPerShift: number | null
  percentOfPayments: number | null
  trialPayMode: TrialPayFormValue
  brackets: Bracket[]
}

export function emptyRate(scheme: SchemeKey = "per_student"): RateFormValue {
  return {
    scheme,
    ratePerStudent: null,
    ratePerLesson: null,
    fixedPerShift: null,
    percentOfPayments: null,
    trialPayMode: "none",
    brackets: [],
  }
}

// Пустая ставка группы: по умолчанию оплата пробного наследуется от личной
// ставки инструктора (inherit → NULL в БД) — поведение как до появления поля.
export function emptyGroupRate(scheme: SchemeKey = "per_student"): RateFormValue {
  return { ...emptyRate(scheme), trialPayMode: "inherit" }
}

interface SalaryRateFormProps {
  value: RateFormValue
  onChange: (v: RateFormValue) => void
  /**
   * Контекст «ставка группы»: показывает доп. вариант «По ставке инструктора»
   * (inherit → NULL в БД). По умолчанию форма личной ставки — inherit недоступен.
   */
  groupContext?: boolean
}

function numInput(v: number | null): string {
  return v === null || Number.isNaN(v) ? "" : String(v)
}
function parseNum(s: string): number | null {
  if (s.trim() === "") return null
  const n = Number(s)
  return Number.isNaN(n) ? null : n
}

export function SalaryRateForm({ value, onChange, groupContext }: SalaryRateFormProps) {
  const sym = useCurrencySymbol()
  const patch = (p: Partial<RateFormValue>) => onChange({ ...value, ...p })

  function addBracket() {
    const next = [...value.brackets]
    const lastMin = next[next.length - 1]?.minStudents ?? 0
    next.push({ minStudents: lastMin + 1, ratePerLesson: 0 })
    patch({ brackets: next })
  }
  function removeBracket(i: number) {
    patch({ brackets: value.brackets.filter((_, idx) => idx !== i) })
  }
  function updateBracket(i: number, b: Partial<Bracket>) {
    patch({
      brackets: value.brackets.map((br, idx) => (idx === i ? { ...br, ...b } : br)),
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Схема оплаты</Label>
        <select
          value={value.scheme}
          onChange={(e) => patch({ scheme: e.target.value as SchemeKey })}
          className="h-9 w-full rounded border bg-background px-3 text-sm"
        >
          {(Object.keys(SCHEME_LABELS) as SchemeKey[]).map((k) => (
            <option key={k} value={k}>
              {SCHEME_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {(value.scheme === "per_student" || value.scheme === "fixed_plus_per_student") && (
        <div className="space-y-1.5">
          <Label>Ставка за ученика, {sym}</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={numInput(value.ratePerStudent)}
            onChange={(e) => patch({ ratePerStudent: parseNum(e.target.value) })}
          />
        </div>
      )}

      {value.scheme === "per_lesson" && (
        <div className="space-y-1.5">
          <Label>Ставка за занятие, {sym}</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={numInput(value.ratePerLesson)}
            onChange={(e) => patch({ ratePerLesson: parseNum(e.target.value) })}
          />
        </div>
      )}

      {value.scheme === "fixed_plus_per_student" && (
        <div className="space-y-1.5">
          <Label>Фикс за выход, {sym}</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={numInput(value.fixedPerShift)}
            onChange={(e) => patch({ fixedPerShift: parseNum(e.target.value) })}
          />
        </div>
      )}

      {value.scheme === "percent_of_payments" && (
        <div className="space-y-1.5">
          <Label>Процент от факт-списаний, %</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={numInput(value.percentOfPayments)}
            onChange={(e) => patch({ percentOfPayments: parseNum(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            ЗП за каждого ученика = chargeAmount × процент. Сумма списаний с
            абонементов берётся «как есть», возвраты при chargePercent &lt; 100% не учитываются.
          </p>
        </div>
      )}

      {value.scheme === "floating_by_students" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Матрица: количество учеников → ставка за занятие</Label>
            <Button type="button" size="sm" variant="outline" onClick={addBracket}>
              <Plus className="mr-1 size-3" /> Строка
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Желательно заполнить вплоть до 12 учеников. Если в группе больше, чем
            указано — заплатим за максимум из матрицы.
          </p>
          {value.brackets.length === 0 ? (
            <div className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
              Добавьте хотя бы одну строку.
            </div>
          ) : (
            <div className="space-y-1">
              {value.brackets.map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">от</span>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={b.minStudents}
                    onChange={(e) =>
                      updateBracket(i, { minStudents: parseInt(e.target.value, 10) || 1 })
                    }
                    className="h-8 w-16"
                  />
                  <span className="text-xs text-muted-foreground">учеников →</span>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={b.ratePerLesson}
                    onChange={(e) =>
                      updateBracket(i, { ratePerLesson: parseNum(e.target.value) ?? 0 })
                    }
                    className="h-8 w-24"
                  />
                  <span className="text-xs text-muted-foreground">{sym}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => removeBracket(i)}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5 border-t pt-4">
        <Label>Оплата за пробное занятие</Label>
        <select
          value={value.trialPayMode}
          onChange={(e) => patch({ trialPayMode: e.target.value as TrialPayFormValue })}
          className="h-9 w-full rounded border bg-background px-3 text-sm"
        >
          {groupContext && <option value="inherit">{TRIAL_INHERIT_LABEL}</option>}
          {(Object.keys(TRIAL_PAY_LABELS) as TrialPayMode[]).map((k) => (
            <option key={k} value={k}>
              {TRIAL_PAY_LABELS[k]}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          {value.trialPayMode === "inherit"
            ? TRIAL_INHERIT_HINT
            : TRIAL_PAY_HINTS[value.trialPayMode]}
        </p>
      </div>
    </div>
  )
}
