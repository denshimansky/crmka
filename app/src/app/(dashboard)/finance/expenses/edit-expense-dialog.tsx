"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"

interface CategoryOption {
  id: string
  name: string
  isVariable: boolean
}

interface AccountOption {
  id: string
  name: string
}

interface BranchOption {
  id: string
  name: string
}

interface DirectionOption {
  id: string
  name: string
  branchIds: string[]
}

interface LeadChannelOption {
  id: string
  name: string
}

const MARKETING_CATEGORY_NAME = "Маркетинг и реклама"
const NONE_VALUE = "__none__"

type RecognitionMode = "by_payment_date" | "single_period" | "amortized"

interface ExpenseData {
  id: string
  categoryId: string
  accountId: string
  amount: number
  date: string
  comment: string | null
  isRecurring: boolean
  recognitionMode: RecognitionMode
  amortizationMonths: number | null
  amortizationStartDate: string | null
  branchIds: string[]
  directionId: string | null
  leadChannelId: string | null
}

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
  const yy = Math.floor(k / 12)
  const mm = (k % 12) + 1
  return `${yy}-${String(mm).padStart(2, "0")}`
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount)
}

export function EditExpenseDialog({
  expense,
  categories,
  accounts,
  branches,
  directions,
  leadChannels,
  open,
  onOpenChange,
}: {
  expense: ExpenseData
  categories: CategoryOption[]
  accounts: AccountOption[]
  branches: BranchOption[]
  directions: DirectionOption[]
  leadChannels: LeadChannelOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initialMonth = expense.amortizationStartDate
    ? expense.amortizationStartDate.slice(0, 7)
    : expense.date.slice(0, 7)

  const [categoryId, setCategoryId] = useState(expense.categoryId)
  const [accountId, setAccountId] = useState(expense.accountId)
  const [amount, setAmount] = useState(String(expense.amount))
  const [date, setDate] = useState(expense.date)
  const [comment, setComment] = useState(expense.comment || "")
  const [isRecurring, setIsRecurring] = useState(expense.isRecurring)
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>(expense.recognitionMode)
  const [singleMonth, setSingleMonth] = useState(initialMonth)
  const [amortStartMonth, setAmortStartMonth] = useState(initialMonth)
  const [amortMonths, setAmortMonths] = useState(
    expense.amortizationMonths && expense.amortizationMonths >= 2
      ? String(expense.amortizationMonths)
      : "3"
  )
  const [selectedBranches, setSelectedBranches] = useState<string[]>(expense.branchIds)
  const [directionId, setDirectionId] = useState<string>(expense.directionId ?? "")
  const [leadChannelId, setLeadChannelId] = useState<string>(expense.leadChannelId ?? "")

  function toggleBranch(branchId: string) {
    setSelectedBranches(prev => {
      const next = prev.includes(branchId)
        ? prev.filter(b => b !== branchId)
        : [...prev, branchId]
      if (directionId) {
        const dir = directions.find((d) => d.id === directionId)
        const stillAvailable =
          next.length === 0 || (dir && dir.branchIds.some((bid) => next.includes(bid)))
        if (!stillAvailable) setDirectionId("")
      }
      return next
    })
  }

  function changeCategory(newCategoryId: string) {
    setCategoryId(newCategoryId)
    const cat = categories.find((c) => c.id === newCategoryId)
    if (cat?.name !== MARKETING_CATEGORY_NAME && leadChannelId) {
      setLeadChannelId("")
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!categoryId) { setError("Выберите статью расхода"); return }
    if (!accountId) { setError("Выберите счёт"); return }
    if (!amount || Number(amount) <= 0) { setError("Укажите сумму"); return }
    if (!date) { setError("Укажите дату"); return }

    let amortizationStartDate: string | null = null
    let amortizationMonths: number | null = null
    if (recognitionMode === "single_period") {
      amortizationStartDate = `${singleMonth}-01`
      amortizationMonths = 1
    } else if (recognitionMode === "amortized") {
      const n = Number(amortMonths)
      if (!Number.isFinite(n) || n < 2 || n > 60) {
        setError("Количество месяцев должно быть от 2 до 60")
        return
      }
      amortizationStartDate = `${amortStartMonth}-01`
      amortizationMonths = n
    }

    const selectedCategory = categories.find((c) => c.id === categoryId)
    const isMarketing = selectedCategory?.name === MARKETING_CATEGORY_NAME

    setLoading(true)
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          accountId,
          amount: Number(amount),
          date,
          comment: comment || undefined,
          isRecurring,
          recognitionMode,
          amortizationStartDate,
          amortizationMonths,
          branchIds: selectedBranches,
          directionId: directionId || null,
          leadChannelId: isMarketing && leadChannelId ? leadChannelId : null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при обновлении расхода")
        return
      }

      onOpenChange(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirm("Удалить расход? Сумма будет возвращена на счёт.")) return

    setLoading(true)
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при удалении")
        return
      }
      onOpenChange(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedCategory = categories.find(c => c.id === categoryId)
  const selectedAccount = accounts.find(a => a.id === accountId)
  const isMarketing = selectedCategory?.name === MARKETING_CATEGORY_NAME

  const availableDirections =
    selectedBranches.length === 0
      ? directions
      : directions.filter((d) =>
          d.branchIds.some((bid) => selectedBranches.includes(bid)),
        )
  const selectedDirection = availableDirections.find((d) => d.id === directionId)
  const selectedChannel = leadChannels.find((c) => c.id === leadChannelId)

  const amountNum = Number(amount) || 0
  const amortN = Math.max(2, Math.min(60, Number(amortMonths) || 0))
  const amortPerMonth = amountNum > 0 && amortN > 0 ? amountNum / amortN : 0
  const amortEndMonth = shiftMonth(amortStartMonth, amortN - 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Редактировать расход</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Статья расхода *</Label>
            <Select value={categoryId} onValueChange={(v) => { if (v) changeCategory(v) }}>
              <SelectTrigger className="w-full">
                {selectedCategory ? selectedCategory.name : "Выберите статью"}
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Сумма *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Дата платежа *</Label>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Счёт *</Label>
            <Select value={accountId} onValueChange={(v) => { if (v) setAccountId(v) }}>
              <SelectTrigger className="w-full">
                {selectedAccount ? selectedAccount.name : "Выберите счёт"}
              </SelectTrigger>
              <SelectContent>
                {accounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {branches.length > 1 && (
            <div className="space-y-1.5">
              <Label>Филиалы</Label>
              <div className="flex flex-wrap gap-2">
                {branches.map(b => (
                  <label key={b.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={selectedBranches.includes(b.id)}
                      onCheckedChange={() => toggleBranch(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {availableDirections.length > 0 && (
            <div className="space-y-1.5">
              <Label>Направление</Label>
              <Select
                value={directionId || NONE_VALUE}
                onValueChange={(v) => setDirectionId(!v || v === NONE_VALUE ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  {selectedDirection ? selectedDirection.name : "Не указано (распределить по выручке)"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Не указано —</SelectItem>
                  {availableDirections.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isMarketing && (
            <div className="space-y-1.5">
              <Label>Канал привлечения</Label>
              <Select
                value={leadChannelId || NONE_VALUE}
                onValueChange={(v) => setLeadChannelId(!v || v === NONE_VALUE ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  {selectedChannel ? selectedChannel.name : "Не указан"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Не указан —</SelectItem>
                  {leadChannels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Input
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Необязательно"
            />
          </div>

          {/* Чекбокс «Повторяющийся» временно скрыт — нет настоящей автоматики,
              только ручное копирование между месяцами. Значение существующего
              расхода сохраняется (isRecurring приходит как есть и не меняется). */}

          {/* Блок «Как провести в ОПИУ» */}
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Как провести в ОПИУ</legend>
            <p className="text-xs text-muted-foreground">
              В ДДС расход всегда учитывается по дате платежа. В ОПИУ — по периоду признания.
            </p>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="recognition-mode-edit"
                className="mt-1"
                checked={recognitionMode === "by_payment_date"}
                onChange={() => setRecognitionMode("by_payment_date")}
              />
              <span>
                <span className="font-medium">Одной суммой по дате платежа</span>
                <span className="block text-xs text-muted-foreground">
                  ОПИУ и ДДС совпадают: расход относится к месяцу даты выше.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="recognition-mode-edit"
                className="mt-1"
                checked={recognitionMode === "single_period"}
                onChange={() => setRecognitionMode("single_period")}
              />
              <span className="flex-1">
                <span className="font-medium">Одной суммой в другом месяце</span>
                <span className="block text-xs text-muted-foreground">
                  Например, аренда июня оплачена 25 мая → ОПИУ июнь.
                </span>
                {recognitionMode === "single_period" && (
                  <div className="mt-2 space-y-1.5">
                    <Label className="text-xs">Месяц признания</Label>
                    <Input
                      type="month"
                      value={singleMonth}
                      onChange={(e) => setSingleMonth(e.target.value)}
                    />
                  </div>
                )}
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="recognition-mode-edit"
                className="mt-1"
                checked={recognitionMode === "amortized"}
                onChange={() => setRecognitionMode("amortized")}
              />
              <span className="flex-1">
                <span className="font-medium">Разделить на N месяцев</span>
                <span className="block text-xs text-muted-foreground">
                  Например, принтер 30 000 ₽ на 3 месяца → по 10 000 ₽/мес.
                </span>
                {recognitionMode === "amortized" && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Начиная с</Label>
                      <Input
                        type="month"
                        value={amortStartMonth}
                        onChange={(e) => setAmortStartMonth(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Месяцев</Label>
                      <Input
                        type="number"
                        min="2"
                        max="60"
                        value={amortMonths}
                        onChange={(e) => setAmortMonths(e.target.value)}
                      />
                    </div>
                    {amortPerMonth > 0 && (
                      <p className="col-span-2 text-xs text-muted-foreground">
                        {formatMonth(amortStartMonth)} — {formatMonth(amortEndMonth)} (по {formatMoney(amortPerMonth)} ₽/мес)
                      </p>
                    )}
                  </div>
                )}
              </span>
            </label>
          </fieldset>

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              Удалить
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
