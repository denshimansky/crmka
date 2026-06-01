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
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Plus } from "lucide-react"

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

type RecognitionMode = "by_payment_date" | "single_period" | "amortized"

const MONTH_NAMES = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
]

function formatMonth(yyyymm: string): string {
  // yyyymm = "2026-06"
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

export function AddExpenseDialog({
  categories,
  accounts,
  branches,
}: {
  categories: CategoryOption[]
  accounts: AccountOption[]
  branches: BranchOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const todayIso = new Date().toISOString().slice(0, 10)
  const todayMonth = todayIso.slice(0, 7)

  const [categoryId, setCategoryId] = useState("")
  const [accountId, setAccountId] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(todayIso)
  const [comment, setComment] = useState("")
  const [isRecurring, setIsRecurring] = useState(false)
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>("by_payment_date")
  const [singleMonth, setSingleMonth] = useState(todayMonth)
  const [amortStartMonth, setAmortStartMonth] = useState(todayMonth)
  const [amortMonths, setAmortMonths] = useState("3")
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])

  function reset() {
    setCategoryId("")
    setAccountId("")
    setAmount("")
    setDate(todayIso)
    setComment("")
    setIsRecurring(false)
    setRecognitionMode("by_payment_date")
    setSingleMonth(todayMonth)
    setAmortStartMonth(todayMonth)
    setAmortMonths("3")
    setSelectedBranches([])
    setError(null)
  }

  function toggleBranch(branchId: string) {
    setSelectedBranches(prev =>
      prev.includes(branchId)
        ? prev.filter(b => b !== branchId)
        : [...prev, branchId]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!categoryId) { setError("Выберите статью расхода"); return }
    if (!accountId) { setError("Выберите счёт"); return }
    if (!amount || Number(amount) <= 0) { setError("Укажите сумму"); return }
    if (!date) { setError("Укажите дату"); return }

    let amortizationStartDate: string | undefined
    let amortizationMonths: number | undefined
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

    const selectedCategory = categories.find(c => c.id === categoryId)

    setLoading(true)
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          accountId,
          amount: Number(amount),
          date,
          comment: comment || undefined,
          isVariable: selectedCategory?.isVariable ?? false,
          isRecurring,
          recognitionMode,
          amortizationStartDate,
          amortizationMonths,
          branchIds: selectedBranches,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании расхода")
        return
      }

      reset()
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedCategory = categories.find(c => c.id === categoryId)
  const selectedAccount = accounts.find(a => a.id === accountId)

  // Превью раскладки.
  const amountNum = Number(amount) || 0
  const amortN = Math.max(2, Math.min(60, Number(amortMonths) || 0))
  const amortPerMonth = amountNum > 0 && amortN > 0 ? amountNum / amortN : 0
  const amortEndMonth = shiftMonth(amortStartMonth, amortN - 1)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 size-4" />
        Внести расход
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый расход</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Статья расхода *</Label>
            <Select value={categoryId} onValueChange={(v) => { if (v) setCategoryId(v) }}>
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
              <p className="text-xs text-muted-foreground">
                {selectedBranches.length === 0 ? "Все филиалы" : `Выбрано: ${selectedBranches.length}`}
              </p>
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

          <label className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={isRecurring}
              onCheckedChange={(v) => setIsRecurring(v === true)}
            />
            Повторяющийся (автодублирование ежемесячно)
          </label>

          {/* Блок «Как провести в ОПИУ» */}
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Как провести в ОПИУ</legend>
            <p className="text-xs text-muted-foreground">
              В ДДС расход всегда учитывается по дате платежа. В ОПИУ — по периоду признания.
            </p>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="recognition-mode"
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
                name="recognition-mode"
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
                name="recognition-mode"
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

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
