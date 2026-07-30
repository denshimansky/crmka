"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CreditCard } from "lucide-react"
import { useMoneyFormat } from "@/components/currency-provider"

// История оплат клиента карточками, «Показать ещё».

type Payment = {
  id: string
  date: string
  amount: number
  type: string
  method: string
  directionName: string | null
}

type Data = { hasMore: boolean; items: Payment[] }

const PAYMENT_METHOD: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Безнал",
  acquiring: "Эквайринг",
  online_yukassa: "Онлайн (ЮKassa)",
  online_robokassa: "Онлайн (Робокасса)",
  sbp_qr: "СБП",
}

export function PaymentsList() {
  const formatMoney = useMoneyFormat()
  const [data, setData] = useState<Data | null>(null)
  const [items, setItems] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async (offset: number) => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/portal/payments?offset=${offset}`)
      if (!res.ok) throw new Error("Не удалось загрузить оплаты")
      const json: Data = await res.json()
      setData(json)
      setItems((prev) => (offset === 0 ? json.items : [...prev, ...json.items]))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(0)
  }, [load])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CreditCard className="size-4" />
          История оплат
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-center text-sm text-destructive">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Оплат пока нет</p>
        )}

        <div className="space-y-2">
          {items.map((p) => {
            const isRefund = p.type === "refund"
            return (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {new Date(p.date).toLocaleDateString("ru")}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[p.directionName || "Пополнение баланса", PAYMENT_METHOD[p.method] || p.method]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className={`shrink-0 font-semibold ${isRefund ? "text-destructive" : ""}`}>
                  {isRefund ? "−" : "+"}
                  {formatMoney(p.amount)}
                </div>
              </div>
            )
          })}
        </div>

        {loading && <p className="py-2 text-center text-sm text-muted-foreground">Загрузка…</p>}
        {data?.hasMore && !loading && (
          <Button variant="outline" className="w-full" onClick={() => load(items.length)}>
            Показать ещё
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
