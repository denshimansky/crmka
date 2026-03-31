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

interface ExpenseData {
  id: string
  categoryId: string
  accountId: string
  amount: number
  date: string
  comment: string | null
  isRecurring: boolean
  amortizationMonths: number | null
  branchIds: string[]
}

export function EditExpenseDialog({
  expense,
  categories,
  accounts,
  branches,
  open,
  onOpenChange,
}: {
  expense: ExpenseData
  categories: CategoryOption[]
  accounts: AccountOption[]
  branches: BranchOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [categoryId, setCategoryId] = useState(expense.categoryId)
  const [accountId, setAccountId] = useState(expense.accountId)
  const [amount, setAmount] = useState(String(expense.amount))
  const [date, setDate] = useState(expense.date)
  const [comment, setComment] = useState(expense.comment || "")
  const [isRecurring, setIsRecurring] = useState(expense.isRecurring)
  const [useAmortization, setUseAmortization] = useState(!!expense.amortizationMonths)
  const [amortizationMonths, setAmortizationMonths] = useState(expense.amortizationMonths ? String(expense.amortizationMonths) : "")
  const [selectedBranches, setSelectedBranches] = useState<string[]>(expense.branchIds)

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
          amortizationMonths: useAmortization ? Number(amortizationMonths) : undefined,
          branchIds: selectedBranches,
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
              <Label>Дата *</Label>
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

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={isRecurring}
                onCheckedChange={(v) => setIsRecurring(v === true)}
              />
              Повторяющийся
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={useAmortization}
                onCheckedChange={(v) => setUseAmortization(v === true)}
              />
              Амортизация
            </label>
          </div>

          {useAmortization && (
            <div className="space-y-1.5">
              <Label>Распределить на (мес.)</Label>
              <Input
                type="number"
                min="2"
                max="60"
                value={amortizationMonths}
                onChange={e => setAmortizationMonths(e.target.value)}
                placeholder="12"
              />
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
