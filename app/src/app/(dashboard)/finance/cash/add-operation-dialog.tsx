"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { ArrowRightLeft } from "lucide-react"

interface AccountOption {
  id: string
  name: string
  type: string
}

const TYPE_OPTIONS = [
  { value: "transfer", label: "Перевод между счетами" },
  { value: "encashment", label: "Инкассация (касса → банк)" },
  { value: "owner_withdrawal", label: "Выемка собственника" },
]

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  cash: "касса",
  bank_account: "расчётный счёт",
  acquiring: "эквайринг",
  online: "онлайн",
}

function accountLabel(a: AccountOption): string {
  const t = ACCOUNT_TYPE_LABELS[a.type] || a.type
  return `${a.name} · ${t}`
}

function today(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function AddOperationDialog({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canTransfer = accounts.length >= 2
  const defaultType = canTransfer ? "transfer" : "owner_withdrawal"
  const availableTypes = canTransfer
    ? TYPE_OPTIONS
    : TYPE_OPTIONS.filter(t => t.value === "owner_withdrawal")

  const [type, setType] = useState<string>(defaultType)
  const [fromAccountId, setFromAccountId] = useState("")
  const [toAccountId, setToAccountId] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(today())
  const [description, setDescription] = useState("")

  const needsTo = type === "transfer" || type === "encashment"

  function reset() {
    setType(defaultType)
    setFromAccountId("")
    setToAccountId("")
    setAmount("")
    setDate(today())
    setDescription("")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!type) { setError("Выберите тип операции"); return }
    if (!fromAccountId) { setError("Укажите счёт списания"); return }
    if (needsTo && !toAccountId) { setError("Укажите счёт-получатель"); return }
    if (needsTo && fromAccountId === toAccountId) {
      setError("Счёт-источник и получатель не могут совпадать")
      return
    }
    const amt = Number(amount.replace(",", "."))
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Сумма должна быть больше 0")
      return
    }
    if (!date) { setError("Укажите дату"); return }

    setLoading(true)
    try {
      const res = await fetch("/api/account-operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          fromAccountId,
          toAccountId: needsTo ? toAccountId : undefined,
          amount: amt,
          date,
          description: description.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании операции")
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

  const selectedType = TYPE_OPTIONS.find(t => t.value === type)
  const selectedFrom = accounts.find(a => a.id === fromAccountId)
  const selectedTo = accounts.find(a => a.id === toAccountId)

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <ArrowRightLeft className="mr-2 size-4" />
        Операция
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Новая операция</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Тип *</Label>
              <Select value={type} onValueChange={(v) => { if (v) setType(v) }}>
                <SelectTrigger className="w-full">
                  {selectedType ? selectedType.label : "Выберите тип"}
                </SelectTrigger>
                <SelectContent>
                  {availableTypes.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Откуда *</Label>
              <Select value={fromAccountId} onValueChange={(v) => { if (v) setFromAccountId(v) }}>
                <SelectTrigger className="w-full">
                  {selectedFrom ? accountLabel(selectedFrom) : "Счёт списания"}
                </SelectTrigger>
                <SelectContent>
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{accountLabel(a)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsTo && (
              <div className="space-y-1.5">
                <Label>Куда *</Label>
                <Select value={toAccountId} onValueChange={(v) => { if (v) setToAccountId(v) }}>
                  <SelectTrigger className="w-full">
                    {selectedTo ? accountLabel(selectedTo) : "Счёт получатель"}
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.filter(a => a.id !== fromAccountId).map(a => (
                      <SelectItem key={a.id} value={a.id}>{accountLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Сумма *</Label>
                <Input
                  inputMode="decimal"
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
              <Label>Описание</Label>
              <Input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Необязательно"
              />
            </div>

            <DialogFooter>
              <Button type="submit" disabled={loading}>
                {loading ? "Сохранение..." : "Создать"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
