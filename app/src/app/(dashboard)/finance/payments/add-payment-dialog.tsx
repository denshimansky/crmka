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
import { Checkbox } from "@/components/ui/checkbox"
import { ClientCombobox } from "@/components/client-combobox"
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
  balance: number
}

interface IncomeCategoryOption {
  id: string
  name: string
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
  incomeCategories,
}: {
  clients: ClientOption[]
  accounts: AccountOption[]
  incomeCategories: IncomeCategoryOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isOtherIncome, setIsOtherIncome] = useState(false)
  const [incomeCategoryId, setIncomeCategoryId] = useState("")
  const [clientId, setClientId] = useState("")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("")
  const [accountId, setAccountId] = useState("")
  const [subscriptionId, setSubscriptionId] = useState("")
  const [comment, setComment] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [clientSubs, setClientSubs] = useState<SubOption[]>([])
  const [distributeMode, setDistributeMode] = useState(false)
  const [distribution, setDistribution] = useState<Record<string, string>>({})

  function reset() {
    setIsOtherIncome(false)
    setIncomeCategoryId("")
    setClientId("")
    setAmount("")
    setMethod("")
    setAccountId("")
    setSubscriptionId("")
    setComment("")
    setDate(new Date().toISOString().slice(0, 10))
    setClientSubs([])
    setDistributeMode(false)
    setDistribution({})
    setError(null)
  }

  async function loadClientSubs(cid: string) {
    setClientId(cid)
    setSubscriptionId("")
    setDistributeMode(false)
    setDistribution({})
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
              balance: Number(s.balance),
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

    if (isOtherIncome) {
      if (!incomeCategoryId) { setError("Выберите категорию дохода"); return }
    } else {
      if (!clientId) { setError("Выберите клиента"); return }
    }
    if (!amount || Number(amount) <= 0) { setError("Укажите сумму"); return }
    if (!method) { setError("Выберите способ оплаты"); return }
    if (!accountId) { setError("Выберите счёт"); return }
    if (!date) { setError("Укажите дату"); return }

    let distributionPayload: { subscriptionId: string; amount: number }[] | undefined
    if (!isOtherIncome && distributeMode) {
      distributionPayload = Object.entries(distribution)
        .map(([sid, raw]) => ({ subscriptionId: sid, amount: Number(raw) }))
        .filter((d) => d.amount > 0)
      const distSum = distributionPayload.reduce((s, d) => s + d.amount, 0)
      if (distSum > Number(amount) + 1e-6) {
        setError("Сумма распределения больше суммы платежа")
        return
      }
      for (const d of distributionPayload) {
        const sub = clientSubs.find((s) => s.id === d.subscriptionId)
        if (sub && d.amount > sub.balance + 1e-6) {
          setError(`Сумма по «${sub.label}» больше долга (${sub.balance.toLocaleString("ru-RU")} ₽)`)
          return
        }
      }
      if (distributionPayload.length === 0) distributionPayload = undefined
    }

    setLoading(true)
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: isOtherIncome ? undefined : clientId,
          incomeCategoryId: isOtherIncome ? incomeCategoryId : undefined,
          accountId,
          amount: Number(amount),
          method,
          date,
          subscriptionId:
            isOtherIncome || distributeMode ? undefined : (subscriptionId || undefined),
          distribution: distributionPayload,
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
  const selectedAccount = accounts.find(a => a.id === accountId)
  const selectedSub = clientSubs.find(s => s.id === subscriptionId)
  const selectedIncomeCategory = incomeCategories.find(c => c.id === incomeCategoryId)

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

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isOtherIncome}
              onCheckedChange={(v) => {
                setIsOtherIncome(v === true)
                if (v === true) {
                  setClientId("")
                  setSubscriptionId("")
                  setClientSubs([])
                } else {
                  setIncomeCategoryId("")
                }
              }}
            />
            Прочий доход (без клиента)
          </label>

          {isOtherIncome ? (
            <div className="space-y-1.5">
              <Label>Категория дохода *</Label>
              <Select value={incomeCategoryId} onValueChange={(v) => { if (v) setIncomeCategoryId(v) }}>
                <SelectTrigger className="w-full">
                  {selectedIncomeCategory ? selectedIncomeCategory.name : "Выберите категорию"}
                </SelectTrigger>
                <SelectContent>
                  {incomeCategories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Например: проценты банка, продажа товаров. Не учитывается в выручке ОПИУ (она по списаниям с занятий).
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Клиент *</Label>
              <ClientCombobox
                options={clients}
                value={clientId}
                onChange={(id) => loadClientSubs(id)}
                placeholder="Начните вводить ФИО..."
              />
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

          {!isOtherIncome && clientId && clientSubs.length > 0 && (
            <div className="space-y-2">
              {!distributeMode ? (
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
              ) : (
                <div className="space-y-1.5">
                  <Label>Распределение по абонементам</Label>
                  <div className="rounded-md border divide-y">
                    {clientSubs.filter((s) => s.balance > 0).length === 0 && (
                      <div className="p-2.5 text-xs text-muted-foreground">
                        У клиента нет абонементов с долгом — распределять некуда.
                      </div>
                    )}
                    {clientSubs.filter((s) => s.balance > 0).map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-3 p-2.5">
                        <div className="text-sm min-w-0">
                          <div className="truncate font-medium">{s.label}</div>
                          <div className="text-xs text-muted-foreground">
                            Долг: {s.balance.toLocaleString("ru-RU")} ₽
                          </div>
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max={s.balance}
                          value={distribution[s.id] ?? ""}
                          onChange={(e) => setDistribution((prev) => ({ ...prev, [s.id]: e.target.value }))}
                          className="w-28"
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const used = Object.values(distribution).reduce((s, v) => s + (Number(v) || 0), 0)
                    const amt = Number(amount) || 0
                    const rest = Math.max(0, amt - used)
                    return (
                      <div className="text-xs text-muted-foreground">
                        Распределено: {used.toLocaleString("ru-RU")} ₽ из {amt.toLocaleString("ru-RU")} ₽ ·
                        остаток на баланс родителя: <b>{rest.toLocaleString("ru-RU")} ₽</b>
                      </div>
                    )
                  })()}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={distributeMode}
                  onCheckedChange={(v) => {
                    setDistributeMode(v === true)
                    if (v === true) setSubscriptionId("")
                    else setDistribution({})
                  }}
                />
                Распределить на несколько абонементов
              </label>
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
