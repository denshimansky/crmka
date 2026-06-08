"use client"

import { useState, type ReactNode } from "react"
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

interface IncomeCategoryOption {
  id: string
  name: string
}

const METHOD_OPTIONS = [
  { value: "cash", label: "Наличные" },
  { value: "bank_transfer", label: "Безнал" },
]

// Соответствие метод оплаты → типы счетов. «Наличные» — только кассы (cash),
// «Безнал» — расчётные счета, эквайринг, онлайн-кассы (всё, что не cash).
function accountsForMethod(method: string, accounts: AccountOption[]): AccountOption[] {
  if (method === "cash") return accounts.filter((a) => a.type === "cash")
  if (method === "bank_transfer") return accounts.filter((a) => a.type !== "cash")
  return accounts
}

export function AddPaymentDialog({
  clients,
  accounts,
  incomeCategories,
  lockedClient,
  triggerButton,
}: {
  clients: ClientOption[]
  accounts: AccountOption[]
  incomeCategories: IncomeCategoryOption[]
  /** Если задан — диалог открывается из карточки конкретного клиента:
   *  выбор клиента и переключатель «Прочий доход» скрыты. */
  lockedClient?: ClientOption
  /** Кастомный триггер. По умолчанию — кнопка «+ Оплата». */
  triggerButton?: ReactNode
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [isOtherIncome, setIsOtherIncome] = useState(false)
  const [incomeCategoryId, setIncomeCategoryId] = useState("")
  const [clientId, setClientId] = useState(lockedClient?.id ?? "")
  const [amount, setAmount] = useState("")
  const [method, setMethod] = useState("")
  const [accountId, setAccountId] = useState("")
  const [comment, setComment] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  function reset() {
    setIsOtherIncome(false)
    setIncomeCategoryId("")
    setClientId(lockedClient?.id ?? "")
    setAmount("")
    setMethod("")
    setAccountId("")
    setComment("")
    setDate(new Date().toISOString().slice(0, 10))
    setError(null)
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
  const selectedIncomeCategory = incomeCategories.find(c => c.id === incomeCategoryId)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      {triggerButton ? (
        <DialogTrigger render={triggerButton as React.ReactElement} />
      ) : (
        <DialogTrigger render={<Button />}>
          <Plus className="mr-2 size-4" />
          Оплата
        </DialogTrigger>
      )}
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

          {!lockedClient && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isOtherIncome}
                onCheckedChange={(v) => {
                  setIsOtherIncome(v === true)
                  if (v === true) {
                    setClientId("")
                  } else {
                    setIncomeCategoryId("")
                  }
                }}
              />
              Прочий доход (без клиента)
            </label>
          )}

          {lockedClient ? (
            <div className="space-y-1.5">
              <Label>Клиент</Label>
              <Input value={lockedClient.name} disabled />
              <p className="text-xs text-muted-foreground">
                Деньги попадут на баланс родителя. Списание в счёт абонемента — кнопка «Оплатить с баланса» в карточке абонемента.
              </p>
            </div>
          ) : isOtherIncome ? (
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
                onChange={setClientId}
                placeholder="Начните вводить ФИО..."
              />
              <p className="text-xs text-muted-foreground">
                Деньги попадут на баланс родителя. Списание в счёт абонемента — кнопка «Оплатить с баланса» в карточке абонемента.
              </p>
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
              <Select
                value={method}
                onValueChange={(v) => {
                  if (!v) return
                  setMethod(v)
                  // При смене способа сбрасываем счёт, если он не соответствует
                  // новому методу — иначе админ отправит «нал» с безналового счёта.
                  if (accountId) {
                    const stillValid = accountsForMethod(v, accounts).some((a) => a.id === accountId)
                    if (!stillValid) setAccountId("")
                  }
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
                disabled={!method}
              >
                <SelectTrigger className="w-full">
                  {selectedAccount
                    ? selectedAccount.name
                    : method
                      ? "Выберите счёт"
                      : "Сначала выберите способ"}
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
