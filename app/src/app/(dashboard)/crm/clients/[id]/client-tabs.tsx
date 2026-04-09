"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Plus, Pencil, X, Ban, CalendarDays, Undo2, ArrowLeftRight } from "lucide-react"
import { AddWardForm } from "./add-ward-form"
import { CommunicationFeed } from "@/components/communication-feed"

interface Ward {
  id: string
  firstName: string
  lastName: string | null
  birthDate: string | null // ISO string
}

interface Subscription {
  id: string
  status: string
  periodYear: number
  periodMonth: number
  lessonPrice: string
  totalLessons: number
  totalAmount: string
  finalAmount: string
  balance: string
  direction: { id: string; name: string }
  group: { id: string; name: string }
  ward: { id: string; firstName: string; lastName: string | null } | null
  payments: { id: string; amount: string; date: string; method: string }[]
}

interface Payment {
  id: string
  amount: string
  type: string
  method: string
  date: string
  comment: string | null
  isFirstPayment: boolean
  subscription: {
    id: string
    periodYear: number
    periodMonth: number
    direction: { name: string }
  } | null
  account: { id: string; name: string }
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function calculateAge(birthDate: string): string {
  const birth = new Date(birthDate)
  const now = new Date()
  let years = now.getFullYear() - birth.getFullYear()
  const monthDiff = now.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    years--
  }
  const mod10 = years % 10
  const mod100 = years % 100
  if (mod100 >= 11 && mod100 <= 19) return `${years} лет`
  if (mod10 === 1) return `${years} год`
  if (mod10 >= 2 && mod10 <= 4) return `${years} года`
  return `${years} лет`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидание",
  active: "Активен",
  closed: "Закрыт",
  withdrawn: "Отчислен",
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  closed: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  withdrawn: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Безнал",
  acquiring: "Эквайринг",
  online_yukassa: "ЮKassa",
  online_robokassa: "Робокасса",
  sbp_qr: "СБП",
}

const MONTH_NAMES = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

// ===== Edit Subscription Dialog =====

function EditSubscriptionDialog({
  subscription,
  onSuccess,
}: {
  subscription: Subscription
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [lessonPrice, setLessonPrice] = useState(String(Number(subscription.lessonPrice)))
  const [totalLessons, setTotalLessons] = useState(String(subscription.totalLessons))
  const [discountAmount, setDiscountAmount] = useState(
    String(Number(subscription.finalAmount) < Number(subscription.totalAmount)
      ? Number(subscription.totalAmount) - Number(subscription.finalAmount)
      : 0)
  )

  function reset() {
    setLessonPrice(String(Number(subscription.lessonPrice)))
    setTotalLessons(String(subscription.totalLessons))
    setDiscountAmount(
      String(Number(subscription.finalAmount) < Number(subscription.totalAmount)
        ? Number(subscription.totalAmount) - Number(subscription.finalAmount)
        : 0)
    )
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!lessonPrice || Number(lessonPrice) <= 0) {
      setError("Укажите цену занятия")
      return
    }
    if (!totalLessons || Number(totalLessons) <= 0) {
      setError("Укажите кол-во занятий")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonPrice: Number(lessonPrice),
          totalLessons: Number(totalLessons),
          discountAmount: Number(discountAmount) || 0,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при обновлении абонемента")
        return
      }

      setOpen(false)
      onSuccess()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const totalAmount = (Number(lessonPrice) || 0) * (Number(totalLessons) || 0)
  const finalAmount = totalAmount - (Number(discountAmount) || 0)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="size-7" />}>
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Редактировать абонемент</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Направление:</span>
              <span className="font-medium">{subscription.direction.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Группа:</span>
              <span>{subscription.group.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Период:</span>
              <span>{MONTH_NAMES[subscription.periodMonth]} {subscription.periodYear}</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Цена занятия</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={lessonPrice}
                onChange={(e) => setLessonPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Занятий</Label>
              <Input
                type="number"
                min="1"
                value={totalLessons}
                onChange={(e) => setTotalLessons(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Скидка</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {totalAmount > 0 && (
            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Стоимость:</span>
                <span>{formatMoney(totalAmount)}</span>
              </div>
              {Number(discountAmount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Скидка:</span>
                  <span className="text-red-600">-{formatMoney(Number(discountAmount))}</span>
                </div>
              )}
              <div className="flex justify-between font-bold">
                <span>Итого:</span>
                <span>{formatMoney(finalAmount)}</span>
              </div>
            </div>
          )}

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

// ===== Change Subscription Status =====

function ChangeStatusButton({
  subscription,
  targetStatus,
  label,
  variant = "outline",
  icon: Icon,
  onSuccess,
}: {
  subscription: Subscription
  targetStatus: "closed" | "withdrawn"
  label: string
  variant?: "outline" | "destructive"
  icon: typeof X
  onSuccess: () => void
}) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    if (!confirm(`${label} абонемент "${subscription.direction.name}" (${MONTH_NAMES[subscription.periodMonth]} ${subscription.periodYear})?`)) {
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: targetStatus }),
      })

      if (res.ok) {
        onSuccess()
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant={variant === "destructive" ? "ghost" : "ghost"}
      size="icon"
      className="size-7"
      onClick={handleClick}
      disabled={loading}
      title={label}
    >
      <Icon className={`size-3.5 ${variant === "destructive" ? "text-red-500" : "text-muted-foreground"}`} />
    </Button>
  )
}

// ===== Refund Subscription Dialog =====

interface RefundPreview {
  totalLessons: number
  attendedLessons: number
  remainingLessons: number
  lessonPrice: number
  refundAmount: number
  totalPaid: number
  canRefund: boolean
}

interface AccountOption {
  id: string
  name: string
  type: string
}

function RefundSubscriptionDialog({
  subscription,
  onSuccess,
}: {
  subscription: Subscription
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<RefundPreview | null>(null)
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [accountId, setAccountId] = useState("")
  const [method, setMethod] = useState("cash")
  const [comment, setComment] = useState("")

  async function loadPreview() {
    setLoadingPreview(true)
    setError(null)
    try {
      const [refundRes, accountsRes] = await Promise.all([
        fetch(`/api/subscriptions/${subscription.id}/refund`),
        fetch("/api/financial-accounts"),
      ])
      if (refundRes.ok) {
        const data = await refundRes.json()
        setPreview(data)
        if (!data.canRefund) {
          setError("Возврат невозможен: нет неиспользованных оплаченных занятий")
        }
      } else {
        const data = await refundRes.json().catch(() => ({}))
        setError(data.error || "Ошибка загрузки данных")
      }
      if (accountsRes.ok) {
        const accs = await accountsRes.json()
        setAccounts(accs)
        if (accs.length > 0 && !accountId) setAccountId(accs[0].id)
      }
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoadingPreview(false)
    }
  }

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v) {
      loadPreview()
    } else {
      setPreview(null)
      setError(null)
      setComment("")
    }
  }

  async function handleRefund() {
    if (!accountId) {
      setError("Выберите счёт")
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          method,
          comment: comment || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при возврате")
        return
      }

      setOpen(false)
      onSuccess()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedAccount = accounts.find(a => a.id === accountId)

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={
        <Button variant="ghost" size="icon" className="size-7" title="Возврат">
          <Undo2 className="size-3.5 text-orange-500" />
        </Button>
      } />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Возврат абонемента</DialogTitle>
        </DialogHeader>

        {loadingPreview ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Расчёт...</p>
        ) : error && !preview?.canRefund ? (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : preview ? (
          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Направление:</span>
                <span className="font-medium">{subscription.direction.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Группа:</span>
                <span>{subscription.group.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Период:</span>
                <span>{MONTH_NAMES[subscription.periodMonth]} {subscription.periodYear}</span>
              </div>
            </div>

            <div className="rounded-md border border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Всего занятий:</span>
                <span>{preview.totalLessons}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Посещено:</span>
                <span>{preview.attendedLessons}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Остаток занятий:</span>
                <span className="font-medium">{preview.remainingLessons}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Цена занятия:</span>
                <span>{formatMoney(preview.lessonPrice)}</span>
              </div>
              <hr className="my-1 border-orange-200 dark:border-orange-800" />
              <div className="flex justify-between font-bold text-base">
                <span>Сумма возврата:</span>
                <span className="text-orange-600">{formatMoney(preview.refundAmount)}</span>
              </div>
            </div>

            <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-3 text-sm text-yellow-800 dark:text-yellow-200">
              Абонемент будет деактивирован, ученик отчислен из группы. Это действие необратимо.
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Счёт для списания *</Label>
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
                <Label>Способ возврата</Label>
                <Select value={method} onValueChange={(v) => { if (v) setMethod(v) }}>
                  <SelectTrigger className="w-full">
                    {METHOD_LABELS[method] || method}
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(METHOD_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Комментарий</Label>
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Причина возврата"
                  maxLength={500}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
              <Button
                variant="destructive"
                onClick={handleRefund}
                disabled={loading || !preview.canRefund || !accountId}
              >
                {loading ? "Обработка..." : `Вернуть ${formatMoney(preview.refundAmount)}`}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ===== Transfer Balance Dialog =====

interface TransferTarget {
  id: string
  direction: string
  group: string
  periodYear: number
  periodMonth: number
  balance: number
  status: string
}

interface TransferInfo {
  sourceId: string
  direction: string
  group: string
  totalPaid: number
  chargedAmount: number
  available: number
  balance: number
  targets: TransferTarget[]
}

function TransferBalanceDialog({
  subscription,
  onSuccess,
}: {
  subscription: Subscription
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<TransferInfo | null>(null)
  const [targetId, setTargetId] = useState("")
  const [amount, setAmount] = useState("")

  async function loadTransferInfo() {
    setLoadingInfo(true)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}/transfer-balance`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка загрузки")
        return
      }
      const data: TransferInfo = await res.json()
      setInfo(data)
      setAmount(String(data.available))
      if (data.targets.length === 1) {
        setTargetId(data.targets[0].id)
      }
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoadingInfo(false)
    }
  }

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v) {
      loadTransferInfo()
    } else {
      setInfo(null)
      setTargetId("")
      setAmount("")
      setError(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!targetId) { setError("Выберите абонемент-получатель"); return }
    const numAmount = Number(amount)
    if (!numAmount || numAmount <= 0) { setError("Укажите сумму"); return }
    if (info && numAmount > info.available) {
      setError(`Максимальная сумма: ${info.available.toFixed(2)} ₽`)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}/transfer-balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetSubscriptionId: targetId,
          amount: numAmount,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка переноса")
        return
      }

      setOpen(false)
      onSuccess()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedTarget = info?.targets.find(t => t.id === targetId)
  const numAmount = Number(amount) || 0

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="size-7" title="Перенести баланс" />}>
        <ArrowLeftRight className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Перенос баланса</DialogTitle>
        </DialogHeader>

        {loadingInfo ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Загрузка...</p>
        ) : info && info.available <= 0 ? (
          <div className="space-y-3">
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              На абонементе нет доступных средств для переноса
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Оплачено:</span>
                <span>{formatMoney(info.totalPaid)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Использовано:</span>
                <span>{formatMoney(info.chargedAmount)}</span>
              </div>
            </div>
          </div>
        ) : info && info.targets.length === 0 ? (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            У клиента нет других активных абонементов для переноса
          </div>
        ) : info ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              <div className="text-xs text-muted-foreground uppercase font-medium mb-1">Источник</div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Абонемент:</span>
                <span className="font-medium">{info.direction} — {info.group}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Оплачено:</span>
                <span>{formatMoney(info.totalPaid)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Использовано:</span>
                <span>{formatMoney(info.chargedAmount)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Доступно:</span>
                <span className="text-green-600">{formatMoney(info.available)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Перенести на абонемент *</Label>
              <Select value={targetId} onValueChange={(v) => { if (v) setTargetId(v) }}>
                <SelectTrigger className="w-full">
                  {selectedTarget
                    ? `${selectedTarget.direction} — ${selectedTarget.group} (${MONTH_NAMES[selectedTarget.periodMonth]} ${selectedTarget.periodYear})`
                    : "Выберите абонемент"}
                </SelectTrigger>
                <SelectContent>
                  {info.targets.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.direction} — {t.group} ({MONTH_NAMES[t.periodMonth]} {t.periodYear})
                      {t.balance > 0 ? ` \u2022 долг ${formatMoney(t.balance)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Сумма переноса *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={info.available}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Максимум: {formatMoney(info.available)}</p>
            </div>

            {numAmount > 0 && selectedTarget && (
              <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 text-sm space-y-1">
                <div className="text-xs text-blue-600 dark:text-blue-400 uppercase font-medium mb-1">Предпросмотр</div>
                <div>
                  Списать <span className="font-bold">{formatMoney(numAmount)}</span> с &laquo;{info.direction}&raquo;
                </div>
                <div>
                  Зачислить на &laquo;{selectedTarget.direction}&raquo; ({MONTH_NAMES[selectedTarget.periodMonth]} {selectedTarget.periodYear})
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Перенос..." : "Перенести"}
              </Button>
            </DialogFooter>
          </form>
        ) : error ? (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ===== Subscriptions Tab =====

function SubscriptionsTab({ clientId, wards }: { clientId: string; wards: Ward[] }) {
  const router = useRouter()
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loadingSubs, setLoadingSubs] = useState(true)

  const loadSubs = useCallback(async () => {
    try {
      const res = await fetch(`/api/subscriptions?clientId=${clientId}`)
      if (res.ok) setSubs(await res.json())
    } catch { /* ignore */ }
    finally { setLoadingSubs(false) }
  }, [clientId])

  useEffect(() => { loadSubs() }, [loadSubs])

  const handleSubUpdated = useCallback(() => {
    loadSubs()
    router.refresh()
  }, [loadSubs, router])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Абонементы ({subs.length})</CardTitle>
          <AddSubscriptionDialog clientId={clientId} wards={wards} onSuccess={handleSubUpdated} />
        </div>
      </CardHeader>
      <CardContent>
        {loadingSubs ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Загрузка...</p>
        ) : subs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Нет абонементов</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Направление</TableHead>
                <TableHead>Группа</TableHead>
                <TableHead>Период</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">К оплате</TableHead>
                <TableHead className="text-right">Оплачено</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s) => {
                const paid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0)
                const balance = Number(s.balance)
                const canEdit = s.status === "pending" || s.status === "active"
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.direction.name}</TableCell>
                    <TableCell>{s.group.name}</TableCell>
                    <TableCell>{MONTH_NAMES[s.periodMonth]} {s.periodYear}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[s.status] || ""}`}>
                        {STATUS_LABELS[s.status] || s.status}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
                      {balance > 0 ? formatMoney(balance) : "Оплачен"}
                    </TableCell>
                    <TableCell className="text-right text-green-600">
                      {paid > 0 ? formatMoney(paid) : "—"}
                    </TableCell>
                    <TableCell>
                      {canEdit && (
                        <div className="flex items-center justify-end gap-0.5">
                          <EditSubscriptionDialog subscription={s} onSuccess={handleSubUpdated} />
                          <TransferBalanceDialog subscription={s} onSuccess={handleSubUpdated} />
                          <RefundSubscriptionDialog subscription={s} onSuccess={handleSubUpdated} />
                          <ChangeStatusButton
                            subscription={s}
                            targetStatus="closed"
                            label="Закрыть"
                            icon={X}
                            onSuccess={handleSubUpdated}
                          />
                          <ChangeStatusButton
                            subscription={s}
                            targetStatus="withdrawn"
                            label="Отчислить"
                            variant="destructive"
                            icon={Ban}
                            onSuccess={handleSubUpdated}
                          />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ===== Payments Tab =====

function PaymentsTab({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loadingPayments, setLoadingPayments] = useState(true)
  const [showRefund, setShowRefund] = useState(false)
  const [refundLoading, setRefundLoading] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)
  const [refundStep, setRefundStep] = useState<"form" | "confirm">("form")
  const [refundAccounts, setRefundAccounts] = useState<{ id: string; name: string; type: string }[]>([])
  const [refundSubs, setRefundSubs] = useState<{ id: string; label: string }[]>([])
  const [refundAmount, setRefundAmount] = useState("")
  const [refundMethod, setRefundMethod] = useState("")
  const [refundAccountId, setRefundAccountId] = useState("")
  const [refundSubId, setRefundSubId] = useState("")
  const [refundComment, setRefundComment] = useState("")
  const [refundDate, setRefundDate] = useState(new Date().toISOString().slice(0, 10))

  const REFUND_METHODS = [
    { value: "cash", label: "Наличные" },
    { value: "bank_transfer", label: "Безнал" },
    { value: "acquiring", label: "Эквайринг" },
    { value: "online_yukassa", label: "ЮKassa" },
    { value: "online_robokassa", label: "Робокасса" },
    { value: "sbp_qr", label: "СБП" },
  ]

  const loadPayments = useCallback(async () => {
    try {
      const res = await fetch(`/api/payments?clientId=${clientId}`)
      if (res.ok) setPayments(await res.json())
    } catch { /* ignore */ }
    finally { setLoadingPayments(false) }
  }, [clientId])

  useEffect(() => { loadPayments() }, [loadPayments])

  async function openRefundDialog() {
    setShowRefund(true)
    setRefundStep("form")
    setRefundError(null)
    setRefundAmount("")
    setRefundMethod("")
    setRefundAccountId("")
    setRefundSubId("")
    setRefundComment("")
    setRefundDate(new Date().toISOString().slice(0, 10))
    try {
      const [accRes, subRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch(`/api/subscriptions?clientId=${clientId}`),
      ])
      if (accRes.ok) setRefundAccounts(await accRes.json())
      if (subRes.ok) {
        const subs = await subRes.json()
        const MN = ["", "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
        setRefundSubs(
          subs.filter((s: any) => s.status !== "withdrawn").map((s: any) => ({
            id: s.id,
            label: `${s.direction?.name || "?"} — ${MN[s.periodMonth]} ${s.periodYear}`,
          }))
        )
      }
    } catch { /* ignore */ }
  }

  function handleRefundNext(e: React.FormEvent) {
    e.preventDefault()
    setRefundError(null)
    if (!refundAmount || Number(refundAmount) <= 0) { setRefundError("Укажите сумму"); return }
    if (!refundMethod) { setRefundError("Выберите способ"); return }
    if (!refundAccountId) { setRefundError("Выберите счёт"); return }
    if (!refundDate) { setRefundError("Укажите дату"); return }
    setRefundStep("confirm")
  }

  async function handleRefundSubmit() {
    setRefundError(null)
    setRefundLoading(true)
    try {
      const res = await fetch("/api/payments/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          accountId: refundAccountId,
          amount: Number(refundAmount),
          method: refundMethod,
          date: refundDate,
          subscriptionId: refundSubId || undefined,
          comment: refundComment || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRefundError(data.error || "Ошибка при оформлении возврата")
        setRefundStep("form")
        return
      }
      setShowRefund(false)
      loadPayments()
      router.refresh()
    } catch {
      setRefundError("Ошибка сети")
      setRefundStep("form")
    } finally {
      setRefundLoading(false)
    }
  }

  const selMethod = REFUND_METHODS.find(m => m.value === refundMethod)
  const selAccount = refundAccounts.find(a => a.id === refundAccountId)
  const selSub = refundSubs.find(s => s.id === refundSubId)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Оплаты ({payments.length})</CardTitle>
          <Button variant="outline" size="sm" onClick={openRefundDialog}>
            <Undo2 className="mr-1 size-3.5" />
            Возврат
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loadingPayments ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Загрузка...</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Нет оплат</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Назначение</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead>Способ</TableHead>
                <TableHead>Счёт</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => {
                const amt = Number(p.amount)
                const isRefund = p.type === "refund" || amt < 0
                const isTransfer = p.type === "transfer_in"
                const subInfo = p.subscription
                  ? `${p.subscription.direction.name} (${String(p.subscription.periodMonth).padStart(2, "0")}.${p.subscription.periodYear})`
                  : p.comment || "—"
                return (
                  <TableRow key={p.id} className={isRefund ? "bg-red-50/50 dark:bg-red-950/10" : isTransfer ? "bg-blue-50/50 dark:bg-blue-950/10" : undefined}>
                    <TableCell className="text-muted-foreground">{formatDate(p.date)}</TableCell>
                    <TableCell>
                      {subInfo}
                      {isRefund && !isTransfer && amt < 0 && p.comment?.startsWith("Перенос") ? (
                        <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 border-blue-300 text-blue-700 dark:text-blue-400">Перенос</Badge>
                      ) : isRefund ? (
                        <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">Возврат</Badge>
                      ) : null}
                      {isTransfer && (
                        <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 border-blue-300 text-blue-700 dark:text-blue-400">Перенос</Badge>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${isRefund ? "text-red-600" : isTransfer ? "text-blue-600" : "text-green-600"}`}>
                      {isRefund ? `−${formatMoney(Math.abs(amt))}` : formatMoney(amt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{METHOD_LABELS[p.method] || p.method}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.account.name}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Refund Dialog */}
      <Dialog open={showRefund} onOpenChange={setShowRefund}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Возврат средств</DialogTitle>
          </DialogHeader>

          {refundStep === "form" ? (
            <form onSubmit={handleRefundNext} className="space-y-4">
              {refundError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{refundError}</div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Сумма возврата *</Label>
                  <Input type="number" step="0.01" min="0" value={refundAmount} onChange={e => setRefundAmount(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label>Дата *</Label>
                  <Input type="date" value={refundDate} onChange={e => setRefundDate(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Способ *</Label>
                  <Select value={refundMethod} onValueChange={(v) => { if (v) setRefundMethod(v) }}>
                    <SelectTrigger className="w-full">
                      {selMethod ? selMethod.label : "Выберите"}
                    </SelectTrigger>
                    <SelectContent>
                      {REFUND_METHODS.map(m => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Счёт *</Label>
                  <Select value={refundAccountId} onValueChange={(v) => { if (v) setRefundAccountId(v) }}>
                    <SelectTrigger className="w-full">
                      {selAccount ? selAccount.name : "Выберите"}
                    </SelectTrigger>
                    <SelectContent>
                      {refundAccounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {refundSubs.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Абонемент</Label>
                  <Select value={refundSubId} onValueChange={(v) => { if (v !== null) setRefundSubId(v) }}>
                    <SelectTrigger className="w-full">
                      {selSub ? selSub.label : "Без привязки"}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Без привязки</SelectItem>
                      {refundSubs.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Комментарий</Label>
                <Input value={refundComment} onChange={e => setRefundComment(e.target.value)} placeholder="Причина возврата" />
              </div>

              <DialogFooter>
                <Button type="submit" variant="destructive">Далее</Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              {refundError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{refundError}</div>
              )}
              <div className="rounded-md border border-red-200 bg-red-50 p-4 space-y-2 text-sm dark:border-red-900/50 dark:bg-red-950/30">
                <p className="font-medium text-red-800 dark:text-red-300">Подтвердите возврат:</p>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Сумма:</span>
                    <span className="font-bold text-red-600">{`−${formatMoney(Number(refundAmount))}`}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Способ:</span>
                    <span>{selMethod?.label}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Счёт:</span>
                    <span>{selAccount?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Дата:</span>
                    <span>{new Date(refundDate).toLocaleDateString("ru-RU")}</span>
                  </div>
                  {selSub && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Абонемент:</span>
                      <span>{selSub.label}</span>
                    </div>
                  )}
                  {refundComment && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Комментарий:</span>
                      <span>{refundComment}</span>
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setRefundStep("form")} disabled={refundLoading}>Назад</Button>
                <Button variant="destructive" onClick={handleRefundSubmit} disabled={refundLoading}>
                  {refundLoading ? "Оформление..." : "Подтвердить возврат"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ===== Add Subscription Dialog =====

interface DirectionOption {
  id: string
  name: string
  lessonPrice: string
}

interface GroupOption {
  id: string
  name: string
  directionId: string
  templates: { dayOfWeek: number }[]
}

function AddSubscriptionDialog({
  clientId,
  wards,
  onSuccess,
}: {
  clientId: string
  wards: Ward[]
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])

  const [directionId, setDirectionId] = useState("")
  const [groupId, setGroupId] = useState("")
  const [wardId, setWardId] = useState("")
  const [periodYear, setPeriodYear] = useState(String(new Date().getFullYear()))
  const [periodMonth, setPeriodMonth] = useState(String(new Date().getMonth() + 1))
  const [lessonPrice, setLessonPrice] = useState("")
  const [totalLessons, setTotalLessons] = useState("")
  const [discountAmount, setDiscountAmount] = useState("")

  // Загрузка направлений и групп при открытии
  useEffect(() => {
    if (!open) return
    async function load() {
      try {
        const [dirRes, grpRes] = await Promise.all([
          fetch("/api/directions"),
          fetch("/api/groups"),
        ])
        if (dirRes.ok) setDirections(await dirRes.json())
        if (grpRes.ok) setGroups(await grpRes.json())
      } catch { /* ignore */ }
    }
    load()
  }, [open])

  // При выборе направления — установить цену
  function handleDirectionChange(id: string) {
    setDirectionId(id)
    setGroupId("")
    const dir = directions.find(d => d.id === id)
    if (dir) setLessonPrice(String(Number(dir.lessonPrice)))
  }

  // При выборе группы — посчитать кол-во занятий в месяце
  function handleGroupChange(id: string) {
    setGroupId(id)
    const group = groups.find(g => g.id === id)
    if (group && periodYear && periodMonth) {
      const year = Number(periodYear)
      const month = Number(periodMonth)
      const scheduleDays = group.templates.map(t => t.dayOfWeek)
      // Считаем сколько раз каждый день недели встречается в месяце
      let count = 0
      const daysInMonth = new Date(year, month, 0).getDate()
      for (let day = 1; day <= daysInMonth; day++) {
        const dow = new Date(year, month - 1, day).getDay()
        // В schema dayOfWeek: 0=пн, 1=вт... JS: 0=вс, 1=пн...
        // Конвертируем JS dow в наш формат: 0(вс)->6, 1(пн)->0, 2(вт)->1...
        const ourDow = dow === 0 ? 6 : dow - 1
        if (scheduleDays.includes(ourDow)) count++
      }
      setTotalLessons(String(count || 1))
    }
  }

  function reset() {
    setDirectionId("")
    setGroupId("")
    setWardId("")
    setPeriodYear(String(new Date().getFullYear()))
    setPeriodMonth(String(new Date().getMonth() + 1))
    setLessonPrice("")
    setTotalLessons("")
    setDiscountAmount("")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!directionId) { setError("Выберите направление"); return }
    if (!groupId) { setError("Выберите группу"); return }
    if (!lessonPrice || Number(lessonPrice) <= 0) { setError("Укажите цену занятия"); return }
    if (!totalLessons || Number(totalLessons) <= 0) { setError("Укажите кол-во занятий"); return }

    setLoading(true)
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          directionId,
          groupId,
          wardId: wardId || undefined,
          periodYear: Number(periodYear),
          periodMonth: Number(periodMonth),
          lessonPrice: Number(lessonPrice),
          totalLessons: Number(totalLessons),
          discountAmount: Number(discountAmount) || 0,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании абонемента")
        return
      }

      reset()
      setOpen(false)
      onSuccess()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const filteredGroups = directionId ? groups.filter(g => g.directionId === directionId) : []
  const totalAmount = (Number(lessonPrice) || 0) * (Number(totalLessons) || 0)
  const finalAmount = totalAmount - (Number(discountAmount) || 0)

  const selectedDirection = directions.find(d => d.id === directionId)
  const selectedGroup = filteredGroups.find(g => g.id === groupId)
  const selectedWard = wards.find(w => w.id === wardId)

  return (
    <>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
      <Plus className="size-4" />
      Абонемент
    </Button>
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый абонемент</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Направление *</Label>
            <Select value={directionId} onValueChange={(v) => { if (v) handleDirectionChange(v) }}>
              <SelectTrigger className="w-full">
                {selectedDirection ? selectedDirection.name : "Выберите направление"}
              </SelectTrigger>
              <SelectContent>
                {directions.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Группа *</Label>
            <Select value={groupId} onValueChange={(v) => { if (v) handleGroupChange(v) }} disabled={!directionId}>
              <SelectTrigger className="w-full">
                {selectedGroup ? selectedGroup.name : directionId ? "Выберите группу" : "Сначала выберите направление"}
              </SelectTrigger>
              <SelectContent>
                {filteredGroups.map(g => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {wards.length > 0 && (
            <div className="space-y-1.5">
              <Label>Подопечный</Label>
              <Select value={wardId} onValueChange={(v) => { if (v !== null) setWardId(v) }}>
                <SelectTrigger className="w-full">
                  {selectedWard ? [selectedWard.firstName, selectedWard.lastName].filter(Boolean).join(" ") : "Не выбран"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Не выбран</SelectItem>
                  {wards.map(w => (
                    <SelectItem key={w.id} value={w.id}>
                      {[w.firstName, w.lastName].filter(Boolean).join(" ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Год *</Label>
              <Select value={periodYear} onValueChange={(v) => { if (v) setPeriodYear(v) }}>
                <SelectTrigger className="w-full">
                  {periodYear}
                </SelectTrigger>
                <SelectContent>
                  {[2025, 2026, 2027].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Месяц *</Label>
              <Select value={periodMonth} onValueChange={(v) => { if (v) setPeriodMonth(v) }}>
                <SelectTrigger className="w-full">
                  {MONTH_NAMES[Number(periodMonth)] || "Выберите"}
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.slice(1).map((name, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Цена занятия</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={lessonPrice}
                onChange={e => setLessonPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Занятий</Label>
              <Input
                type="number"
                min="1"
                value={totalLessons}
                onChange={e => setTotalLessons(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Скидка</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={discountAmount}
                onChange={e => setDiscountAmount(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {totalAmount > 0 && (
            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Стоимость:</span>
                <span>{formatMoney(totalAmount)}</span>
              </div>
              {Number(discountAmount) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Скидка:</span>
                  <span className="text-red-600">−{formatMoney(Number(discountAmount))}</span>
                </div>
              )}
              <div className="flex justify-between font-bold">
                <span>Итого:</span>
                <span>{formatMoney(finalAmount)}</span>
              </div>
            </div>
          )}

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

// ===== Schedule Tab =====

interface ScheduleLesson {
  id: string
  date: string
  startTime: string
  durationMinutes: number
  groupName: string
  directionName: string
  roomName: string
  instructorName: string
}

const DAY_NAMES = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]

function formatScheduleDate(iso: string): string {
  const d = new Date(iso)
  const day = DAY_NAMES[d.getDay()]
  return `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} (${day})`
}

function ScheduleTab({ clientId }: { clientId: string }) {
  const [lessons, setLessons] = useState<ScheduleLesson[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/clients/${clientId}/schedule`)
        if (res.ok) setLessons(await res.json())
      } catch { /* ignore */ }
      finally { setLoading(false) }
    }
    load()
  }, [clientId])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">Расписание ученика ({lessons.length})</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Загрузка...</p>
        ) : lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Нет предстоящих занятий. Проверьте, что ученик зачислен в группу и расписание сгенерировано.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Время</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Группа</TableHead>
                <TableHead>Педагог</TableHead>
                <TableHead>Кабинет</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap">{formatScheduleDate(l.date)}</TableCell>
                  <TableCell className="whitespace-nowrap">{l.startTime}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{l.directionName}</Badge>
                  </TableCell>
                  <TableCell>{l.groupName}</TableCell>
                  <TableCell className="text-muted-foreground">{l.instructorName}</TableCell>
                  <TableCell className="text-muted-foreground">{l.roomName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ===== Main Component =====

export function ClientTabs({
  clientId,
  wards,
}: {
  clientId: string
  wards: Ward[]
}) {
  return (
    <Tabs defaultValue="wards">
      <TabsList variant="line">
        <TabsTrigger value="wards">Подопечные</TabsTrigger>
        <TabsTrigger value="subscriptions">Абонементы</TabsTrigger>
        <TabsTrigger value="payments">Оплаты</TabsTrigger>
        <TabsTrigger value="schedule">Расписание</TabsTrigger>
        <TabsTrigger value="attendance">Посещения</TabsTrigger>
        <TabsTrigger value="communications">Коммуникации</TabsTrigger>
        <TabsTrigger value="history">История</TabsTrigger>
      </TabsList>

      <TabsContent value="wards">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Подопечные ({wards.length})
              </CardTitle>
              <AddWardForm clientId={clientId} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {wards.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Подопечные не указаны
              </p>
            ) : (
              wards.map((w) => {
                const name = [w.firstName, w.lastName].filter(Boolean).join(" ")
                return (
                  <div
                    key={w.id}
                    className="flex items-center justify-between rounded-md border p-3"
                  >
                    <span className="font-medium">{name}</span>
                    <span className="text-sm text-muted-foreground">
                      {w.birthDate
                        ? `${formatDate(w.birthDate)} (${calculateAge(w.birthDate)})`
                        : "Дата рождения не указана"}
                    </span>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="subscriptions">
        <SubscriptionsTab clientId={clientId} wards={wards} />
      </TabsContent>

      <TabsContent value="payments">
        <PaymentsTab clientId={clientId} />
      </TabsContent>

      <TabsContent value="schedule">
        <ScheduleTab clientId={clientId} />
      </TabsContent>

      <TabsContent value="attendance">
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Будет в модуле 5
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="communications">
        <CommunicationFeed clientId={clientId} />
      </TabsContent>

      <TabsContent value="history">
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Будет позже
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
