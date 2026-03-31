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
import { Plus } from "lucide-react"

interface ClientOption {
  id: string
  name: string
}

interface AccountOption {
  id: string
  name: string
  type: string
}

interface SubOption {
  id: string
  label: string
}

const METHOD_OPTIONS = [
  { value: "cash", label: "Наличные" },
  { value: "bank_transfer", label: "Безнал" },
  { value: "acquiring", label: "Эквайринг" },
  { value: "online_yukassa", label: "ЮKassa" },
  { value: "online_robokassa", label: "Робокасса" },
  { value: "sbp_qr", label: "СБП" },
]

export function AddPaymentDialog({
  clients,
  accounts,
}: {
  clients: ClientOption[]
  accounts: AccountOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [clientId, setClientId] = useState("")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("")
  const [accountId, setAccountId] = useState("")
  const [subscriptionId, setSubscriptionId] = useState("")
  const [comment, setComment] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [clientSubs, setClientSubs] = useState<SubOption[]>([])

  function reset() {
    setClientId("")
    setAmount("")
    setMethod("")
    setAccountId("")
    setSubscriptionId("")
    setComment("")
    setDate(new Date().toISOString().slice(0, 10))
    setClientSubs([])
    setError(null)
  }

  async function loadClientSubs(cid: string) {
    setClientId(cid)
    setSubscriptionId("")
    if (!cid) {
      setClientSubs([])
      return
    }
    try {
      const res = await fetch(`/api/subscriptions?clientId=${cid}`)
      if (res.ok) {
        const subs = await res.json()
        const MONTH_NAMES = ["", "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
        setClientSubs(
          subs
            .filter((s: any) => s.status === "pending" || s.status === "active")
            .map((s: any) => ({
              id: s.id,
              label: `${s.direction?.name || "?"} — ${MONTH_NAMES[s.periodMonth]} ${s.periodYear}`,
            }))
        )
      }
    } catch {
      // ignore
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!clientId) { setError("Выберите клиента"); return }
    if (!amount || Number(amount) <= 0) { setError("Укажите сумму"); return }
    if (!method) { setError("Выберите способ оплаты"); return }
    if (!accountId) { setError("Выберите счёт"); return }
    if (!date) { setError("Укажите дату"); return }

    setLoading(true)
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          accountId,
          amount: Number(amount),
          method,
          date,
          subscriptionId: subscriptionId || undefined,
          comment: comment || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании оплаты")
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

  const selectedMethod = METHOD_OPTIONS.find(m => m.value === method)
  const selectedClient = clients.find(c => c.id === clientId)
  const selectedAccount = accounts.find(a => a.id === accountId)
  const selectedSub = clientSubs.find(s => s.id === subscriptionId)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 size-4" />
        Оплата
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая оплата</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Клиент *</Label>
            <Select value={clientId} onValueChange={(v) => { if (v) loadClientSubs(v) }}>
              <SelectTrigger className="w-full">
                {selectedClient ? selectedClient.name : "Выберите клиента"}
              </SelectTrigger>
              <SelectContent>
                {clients.map(c => (
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Способ оплаты *</Label>
              <Select value={method} onValueChange={(v) => { if (v) setMethod(v) }}>
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
          </div>

          {clientId && clientSubs.length > 0 && (
            <div className="space-y-1.5">
              <Label>Абонемент</Label>
              <Select value={subscriptionId} onValueChange={(v) => { if (v !== null) setSubscriptionId(v) }}>
                <SelectTrigger className="w-full">
                  {selectedSub ? selectedSub.label : "Без привязки к абонементу"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Без привязки</SelectItem>
                  {clientSubs.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
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
