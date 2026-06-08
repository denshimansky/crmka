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
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Pencil } from "lucide-react"

interface AccountOption {
  id: string
  name: string
  type: string
}

interface PaymentInput {
  id: string
  amount: number
  method: string
  date: string
  accountId: string
  comment: string | null
}

const METHOD_OPTIONS = [
  { value: "cash", label: "Наличные" },
  { value: "bank_transfer", label: "Безнал" },
  { value: "acquiring", label: "Эквайринг" },
  { value: "online_yukassa", label: "ЮKassa" },
  { value: "online_robokassa", label: "Робокасса" },
  { value: "sbp_qr", label: "СБП" },
]

function accountsForMethod(method: string, accounts: AccountOption[]): AccountOption[] {
  if (method === "cash") return accounts.filter((a) => a.type === "cash")
  return accounts.filter((a) => a.type !== "cash")
}

export function EditPaymentDialog({
  payment,
  accounts,
}: {
  payment: PaymentInput
  accounts: AccountOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [amount, setAmount] = useState(String(payment.amount))
  const [method, setMethod] = useState(payment.method)
  const [accountId, setAccountId] = useState(payment.accountId)
  const [date, setDate] = useState(payment.date.slice(0, 10))
  const [comment, setComment] = useState(payment.comment ?? "")

  function reset() {
    setAmount(String(payment.amount))
    setMethod(payment.method)
    setAccountId(payment.accountId)
    setDate(payment.date.slice(0, 10))
    setComment(payment.comment ?? "")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!amount || Number(amount) <= 0) { setError("Укажите сумму"); return }
    if (!method) { setError("Выберите способ оплаты"); return }
    if (!accountId) { setError("Выберите счёт"); return }
    if (!date) { setError("Укажите дату"); return }

    setLoading(true)
    try {
      const res = await fetch(`/api/payments/${payment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          method,
          accountId,
          date,
          comment: comment.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }

      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedMethod = METHOD_OPTIONS.find(m => m.value === method)
  const selectedAccount = accounts.find(a => a.id === accountId)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7" title="Редактировать оплату">
            <Pencil className="size-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Редактирование оплаты</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Сумма *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Способ оплаты *</Label>
              <Select
                value={method}
                onValueChange={(v) => {
                  if (!v) return
                  setMethod(v)
                  const stillValid = accountsForMethod(v, accounts).some((a) => a.id === accountId)
                  if (!stillValid) setAccountId("")
                }}
              >
                <SelectTrigger className="w-full">
                  {selectedMethod ? selectedMethod.label : "Выберите способ"}
                </SelectTrigger>
                <SelectContent>
                  {METHOD_OPTIONS.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Счёт *</Label>
              <Select
                value={accountId}
                onValueChange={(v) => { if (v) setAccountId(v) }}
              >
                <SelectTrigger className="w-full">
                  {selectedAccount ? selectedAccount.name : "Выберите счёт"}
                </SelectTrigger>
                <SelectContent>
                  {accountsForMethod(method, accounts).map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

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
