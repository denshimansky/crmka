"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Wallet, AlertCircle } from "lucide-react"

interface SubscriptionLite {
  id: string
  balance: string | number
  status: string
  direction: { name: string }
  group: { name: string }
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

export function PayFromBalanceDialog({
  subscription,
  clientId,
  onSuccess,
}: {
  subscription: SubscriptionLite
  clientId: string
  onSuccess: () => void
}) {
  const router = useRouter()
  const subBalance = Number(subscription.balance)
  const [open, setOpen] = useState(false)
  const [clientBalance, setClientBalance] = useState<number | null>(null)
  const [loadingClient, setLoadingClient] = useState(false)
  const [amount, setAmount] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoadingClient(true)
    setError(null)
    fetch(`/api/clients/${clientId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Не удалось загрузить баланс родителя")
        const data = await r.json()
        const cb = Number(data.clientBalance)
        setClientBalance(cb)
        // Дефолт = min(долг, баланс родителя); если у родителя 0 или минус — 0.
        const def = Math.max(0, Math.min(subBalance, cb))
        setAmount(def > 0 ? String(def) : "")
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingClient(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function reset() {
    setAmount("")
    setError(null)
    setClientBalance(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const num = Number(amount)
    if (!(num > 0)) {
      setError("Сумма должна быть больше 0")
      return
    }
    if (num > subBalance + 1e-6) {
      setError(`Больше долга по абонементу (${fmt(subBalance)} ₽)`)
      return
    }
    if (clientBalance !== null && num > clientBalance + 1e-6) {
      setError(`Больше баланса родителя (${fmt(clientBalance)} ₽)`)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}/pay-from-balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: num }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Ошибка ${res.status}`)
        return
      }
      setOpen(false)
      onSuccess()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const insufficient = clientBalance !== null && clientBalance <= 0
  const cantOpen = subBalance <= 0

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            title={cantOpen ? "Долг по абонементу уже погашен" : "Оплатить с баланса родителя"}
            disabled={cantOpen}
          />
        }
      >
        <Wallet className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Оплатить с баланса родителя</DialogTitle>
          <DialogDescription>
            Списание идёт с кошелька родителя в счёт абонемента{" "}
            <b>{subscription.direction.name}</b> · {subscription.group.name}.
            Разрешена частичная оплата. В ДДС эта операция не попадает.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border p-2.5">
              <div className="text-xs text-muted-foreground">Долг по абонементу</div>
              <div className="font-medium">{fmt(subBalance)} ₽</div>
            </div>
            <div className="rounded-md border p-2.5">
              <div className="text-xs text-muted-foreground">Баланс родителя</div>
              <div className={`font-medium ${insufficient ? "text-destructive" : ""}`}>
                {loadingClient ? "…" : clientBalance !== null ? `${fmt(clientBalance)} ₽` : "—"}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Сумма к оплате</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              disabled={loadingClient || insufficient}
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {insufficient && (
            <div className="text-xs text-muted-foreground">
              На балансе родителя нет средств. Сначала оформите поступление через
              «Добавить оплату» — деньги попадут в кошелёк родителя, затем сможете
              распределить их по абонементам.
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={loading || loadingClient || insufficient}>
              {loading ? "Списываю…" : "Списать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
