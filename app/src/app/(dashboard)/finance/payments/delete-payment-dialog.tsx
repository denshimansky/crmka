"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Trash2 } from "lucide-react"
import { useMoneyFormat } from "@/components/currency-provider"

interface PaymentInfo {
  id: string
  amount: number
  date: string // ISO
  clientName: string | null // null — прочий доход
  accountName: string
}

// Удаление оплаты: подтверждение + откат пополнения (счёт и баланс родителя).
// Кнопка видна только при праве payments.delete (владелец; управляющий — если
// владелец включил в матрице прав). Ошибку «на балансе не хватает» показываем
// текстом из API — там объяснение, что делать.
export function DeletePaymentDialog({ payment }: { payment: PaymentInfo }) {
  const router = useRouter()
  const formatMoney = useMoneyFormat()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/payments/${payment.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось удалить оплату")
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

  const dateLabel = new Date(payment.date).toLocaleDateString("ru-RU")

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null) }}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7 text-destructive hover:text-destructive" title="Удалить оплату">
            <Trash2 className="size-3.5" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Удалить оплату?</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            Оплата <span className="font-medium">{formatMoney(payment.amount)}</span> от {dateLabel}
            {payment.clientName ? <> — {payment.clientName}</> : " (прочий доход)"}.
          </p>
          <p className="text-muted-foreground">
            Сумма будет снята со счёта «{payment.accountName}»
            {payment.clientName ? " и с баланса родителя" : ""}. Действие необратимо.
          </p>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Отмена
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading ? "Удаление..." : "Удалить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
