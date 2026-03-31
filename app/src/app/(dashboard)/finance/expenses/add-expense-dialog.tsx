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

  const [categoryId, setCategoryId] = useState("")
  const [accountId, setAccountId] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState("")
  const [isRecurring, setIsRecurring] = useState(false)
  const [useAmortization, setUseAmortization] = useState(false)
  const [amortizationMonths, setAmortizationMonths] = useState("")
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])

  function reset() {
    setCategoryId("")
    setAccountId("")
    setAmount("")
    setDate(new Date().toISOString().slice(0, 10))
    setComment("")
    setIsRecurring(false)
    setUseAmortization(false)
    setAmortizationMonths("")
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
          amortizationMonths: useAmortization ? Number(amortizationMonths) : undefined,
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
              <p className="text-xs text-muted-foreground">
                {selectedBranches.length === 0 ? "Все филиалы" : `Выбрано: ${selectedBranches.length}`}
              </p>
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
