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
import { Banknote } from "lucide-react"

interface EmployeeOption {
  id: string
  name: string
  remaining: number
}

interface AccountOption {
  id: string
  name: string
}

export function PaySalaryDialog({
  employees,
  accounts,
  periodYear,
  periodMonth,
}: {
  employees: EmployeeOption[]
  accounts: AccountOption[]
  periodYear: number
  periodMonth: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [employeeId, setEmployeeId] = useState("")
  const [accountId, setAccountId] = useState("")
  const [amount, setAmount] = useState("")
  const [comment, setComment] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  function reset() {
    setEmployeeId("")
    setAccountId("")
    setAmount("")
    setComment("")
    setDate(new Date().toISOString().slice(0, 10))
    setError(null)
  }

  const selectedEmployee = employees.find(e => e.id === employeeId)
  const selectedAccount = accounts.find(a => a.id === accountId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!employeeId) { setError("Выберите сотрудника"); return }
    if (!accountId) { setError("Выберите счёт"); return }
    if (!amount || Number(amount) <= 0) { setError("Укажите сумму"); return }

    setLoading(true)
    try {
      const res = await fetch("/api/salary-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          accountId,
          amount: Number(amount),
          date,
          periodYear,
          periodMonth,
          comment: comment || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при выплате")
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

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button />}>
        <Banknote className="mr-2 size-4" />
        Провести выплату
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Выплата зарплаты</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Сотрудник *</Label>
            <Select value={employeeId} onValueChange={(v) => {
              if (v) {
                setEmployeeId(v)
                const emp = employees.find(e => e.id === v)
                if (emp && emp.remaining > 0) setAmount(String(emp.remaining))
              }
            }}>
              <SelectTrigger className="w-full">
                {selectedEmployee ? selectedEmployee.name : "Выберите сотрудника"}
              </SelectTrigger>
              <SelectContent>
                {employees.map(e => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} {e.remaining > 0 ? `(${new Intl.NumberFormat("ru-RU").format(e.remaining)} ₽)` : ""}
                  </SelectItem>
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

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Input
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Аванс / зарплата / ..."
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Выплата..." : "Выплатить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
