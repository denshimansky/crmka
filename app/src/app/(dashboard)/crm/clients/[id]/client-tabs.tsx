"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
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
import { Plus, Pencil, X, Ban, CalendarDays, Undo2, CalendarPlus } from "lucide-react"
import { AddWardForm } from "./add-ward-form"
import { AttendanceTab } from "./attendance-tab"
import { PayFromBalanceDialog } from "./pay-from-balance-dialog"
import { CommunicationFeed } from "@/components/communication-feed"
import { ClientHistory } from "./client-history"
import { formatWardName } from "@/lib/format-name"

interface Ward {
  id: string
  firstName: string
  lastName: string | null
  birthDate: string | null // ISO string
  salesStage?: string
  hasActiveSubscription?: boolean
}

interface Subscription {
  id: string
  status: string
  type?: string
  periodYear: number | null
  periodMonth: number | null
  expiresAt?: string | null
  lessonPrice: string
  totalLessons: number
  totalAmount: string
  finalAmount: string
  balance: string
  chargedAmount: string
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

function formatSubPeriod(s: {
  periodMonth: number | null
  periodYear: number | null
  expiresAt?: string | null
  type?: string
}): string {
  if (s.type === "package") {
    return s.expiresAt
      ? `Пакет до ${new Date(s.expiresAt).toLocaleDateString("ru-RU")}`
      : "Пакет"
  }
  if (s.periodMonth != null && s.periodYear != null) {
    return `${MONTH_NAMES[s.periodMonth]} ${s.periodYear}`
  }
  return "—"
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

  function reset() {
    setLessonPrice(String(Number(subscription.lessonPrice)))
    setTotalLessons(String(subscription.totalLessons))
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
              <span>{formatSubPeriod(subscription)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
          </div>

          {totalAmount > 0 && (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="flex justify-between font-bold">
                <span>Стоимость:</span>
                <span>{formatMoney(totalAmount)}</span>
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

// ===== Close Subscription Dialog =====

interface ClosePreview {
  totalLessons: number
  attendedLessons: number
  remainingLessons: number
  lessonPrice: number
  paidToSubscription: number
  usedAmount: number
  balanceDelta: number
  canClose: boolean
}

function CloseSubscriptionDialog({
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
  const [preview, setPreview] = useState<ClosePreview | null>(null)

  async function loadPreview() {
    setLoadingPreview(true)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}/refund`)
      if (res.ok) {
        const data: ClosePreview = await res.json()
        setPreview(data)
        if (!data.canClose) {
          setError("Закрытие невозможно: абонемент уже закрыт или отчислён")
        }
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка загрузки данных")
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
    }
  }

  async function handleClose() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при закрытии")
        return
      }
      const data = await res.json().catch(() => ({}))
      if (data?._templateDiscountWarning?.message) {
        alert(data._templateDiscountWarning.message)
      }
      setOpen(false)
      onSuccess()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7" title="Закрыть">
            <X className="size-3.5 text-muted-foreground" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Закрыть абонемент</DialogTitle>
        </DialogHeader>

        {loadingPreview ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Расчёт…</p>
        ) : error && !preview?.canClose ? (
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
                <span>{formatSubPeriod(subscription)}</span>
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
                <span className="text-muted-foreground">Оплачено в счёт абонемента:</span>
                <span>{formatMoney(preview.paidToSubscription)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Отработано (стоимость):</span>
                <span>{formatMoney(preview.usedAmount)}</span>
              </div>
              <hr className="my-1 border-orange-200 dark:border-orange-800" />
              <div className="flex justify-between font-bold text-base">
                <span>{preview.balanceDelta >= 0 ? "На баланс родителя:" : "В долг родителя:"}</span>
                <span className={preview.balanceDelta >= 0 ? "text-green-700" : "text-red-600"}>
                  {preview.balanceDelta >= 0
                    ? `+${formatMoney(preview.balanceDelta)}`
                    : `−${formatMoney(Math.abs(preview.balanceDelta))}`}
                </span>
              </div>
            </div>

            <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-3 text-sm text-yellow-800 dark:text-yellow-200 space-y-1.5">
              <p>
                Используйте, когда период абонемента отходил штатно — все занятия проведены.
                Абонемент помечается как <b>завершённый</b>, ребёнок <b>остаётся в группе</b> и
                покупает следующий абонемент.
              </p>
              <p className="text-xs">
                {preview.balanceDelta > 0
                  ? "Остаток возвращается на баланс родителя — он сможет потратить его на следующий абонемент."
                  : preview.balanceDelta < 0
                    ? "По отработанным занятиям клиент не доплатил — долг перейдёт на баланс родителя, клиент попадёт в список должников."
                    : "Оплата и отработка сошлись — баланс клиента не изменится."}
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                Отмена
              </Button>
              <Button onClick={handleClose} disabled={loading || !preview.canClose}>
                {loading
                  ? "Закрытие…"
                  : preview.balanceDelta > 0
                    ? `Закрыть и вернуть ${formatMoney(preview.balanceDelta)}`
                    : preview.balanceDelta < 0
                      ? `Закрыть с долгом ${formatMoney(Math.abs(preview.balanceDelta))}`
                      : "Закрыть абонемент"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ===== Withdraw (Отчислить) Dialog =====

interface WithdrawPreview {
  totalLessons: number
  attendedLessons: number
  remainingLessons: number
  lessonPrice: number
  paidToSubscription: number
  usedAmount: number
  balanceDelta: number
  canClose: boolean
}

interface WithdrawalReasonOption {
  id: string
  name: string
  isActive: boolean
}

function WithdrawSubscriptionDialog({
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
  const [preview, setPreview] = useState<WithdrawPreview | null>(null)
  const [reasons, setReasons] = useState<WithdrawalReasonOption[]>([])
  const [reasonId, setReasonId] = useState<string>("")

  async function loadPreview() {
    setLoadingPreview(true)
    setError(null)
    try {
      const [res, rsRes] = await Promise.all([
        fetch(`/api/subscriptions/${subscription.id}/refund`),
        fetch(`/api/withdrawal-reasons`),
      ])
      if (res.ok) {
        const data = await res.json()
        setPreview(data)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка загрузки данных")
      }
      if (rsRes.ok) {
        const rs: WithdrawalReasonOption[] = await rsRes.json()
        setReasons(rs.filter((r) => r.isActive))
      }
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoadingPreview(false)
    }
  }

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v) loadPreview()
    else {
      setPreview(null)
      setError(null)
      setReasonId("")
    }
  }

  async function handleWithdraw() {
    if (!reasonId) {
      setError("Укажите причину отчисления")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "withdrawn", withdrawalReasonId: reasonId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при отчислении")
        return
      }
      const data = await res.json().catch(() => ({}))
      if (data?._templateDiscountWarning?.message) {
        alert(data._templateDiscountWarning.message)
      }
      setOpen(false)
      onSuccess()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7" title="Отчислить">
            <Ban className="size-3.5 text-red-500" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Отчислить ученика</DialogTitle>
        </DialogHeader>

        {loadingPreview ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Расчёт…</p>
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
                <span>
                  {formatSubPeriod(subscription)}
                </span>
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
              <div className="flex justify-between">
                <span className="text-muted-foreground">Оплачено в счёт абонемента:</span>
                <span>{formatMoney(preview.paidToSubscription)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Отработано (стоимость):</span>
                <span>{formatMoney(preview.usedAmount)}</span>
              </div>
              <hr className="my-1 border-orange-200 dark:border-orange-800" />
              <div className="flex justify-between font-bold text-base">
                <span>{preview.balanceDelta >= 0 ? "На баланс клиента:" : "В долг клиента:"}</span>
                <span className={preview.balanceDelta >= 0 ? "text-orange-600" : "text-red-600"}>
                  {preview.balanceDelta > 0
                    ? `+${formatMoney(preview.balanceDelta)}`
                    : preview.balanceDelta < 0
                      ? `−${formatMoney(Math.abs(preview.balanceDelta))}`
                      : "0 ₽"}
                </span>
              </div>
            </div>

            <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-3 text-sm text-yellow-800 dark:text-yellow-200 space-y-1.5">
              <p>
                Ребёнок будет <b>отчислен из группы</b> и пропадёт из расписания этой
                группы (прошедшие посещения сохранятся).
              </p>
              {preview.balanceDelta > 0 ? (
                <p>
                  Переплата <b>{formatMoney(preview.balanceDelta)}</b> вернётся на баланс
                  родителя — он сможет потратить её на следующий абонемент.
                </p>
              ) : preview.balanceDelta < 0 ? (
                <p>
                  Долг за отработанные занятия <b>{formatMoney(Math.abs(preview.balanceDelta))}</b> уйдёт
                  в минус на баланс родителя. Клиент попадёт в список должников.
                </p>
              ) : (
                <p className="text-xs">
                  Баланс клиента не изменится — оплата и отработка сошлись.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>
                Причина отчисления <span className="text-red-500">*</span>
              </Label>
              {reasons.length === 0 ? (
                <p className="text-xs text-red-600">
                  В справочнике нет активных причин. Добавьте их в{" "}
                  <Link href="/settings/withdrawal-reasons" className="underline">
                    настройках
                  </Link>
                  .
                </p>
              ) : (
                <Select value={reasonId} onValueChange={(v) => { if (v) setReasonId(v) }}>
                  <SelectTrigger className="w-full">
                    {reasons.find((r) => r.id === reasonId)?.name || "Выберите причину"}
                  </SelectTrigger>
                  <SelectContent>
                    {reasons.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={handleWithdraw}
                disabled={loading || !reasonId}
              >
                {loading
                  ? "Обработка…"
                  : preview.balanceDelta > 0
                    ? `Отчислить и вернуть ${formatMoney(preview.balanceDelta)}`
                    : preview.balanceDelta < 0
                      ? `Отчислить с долгом ${formatMoney(Math.abs(preview.balanceDelta))}`
                      : "Отчислить"}
              </Button>
            </DialogFooter>
          </div>
        ) : error ? (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ===== Extend Package Dialog =====

function ExtendPackageDialog({
  subscription,
  onSuccess,
}: {
  subscription: Subscription
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newExpiresAt, setNewExpiresAt] = useState("")

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v) {
      // Открываем диалог с текущей датой истечения как стартом.
      const current = subscription.expiresAt
        ? new Date(subscription.expiresAt)
        : new Date()
      setNewExpiresAt(current.toISOString().slice(0, 10))
      setError(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!newExpiresAt) {
      setError("Укажите новую дату истечения")
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresAt: newExpiresAt }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось продлить срок")
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

  function shift(days: number) {
    const base = subscription.expiresAt ? new Date(subscription.expiresAt) : new Date()
    base.setDate(base.getDate() + days)
    setNewExpiresAt(base.toISOString().slice(0, 10))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon" className="size-7" title="Продлить срок пакета" />}>
        <CalendarPlus className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Продление пакета</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="text-sm text-muted-foreground">
            Текущая дата истечения:{" "}
            <span className="font-medium text-foreground">
              {subscription.expiresAt
                ? new Date(subscription.expiresAt).toLocaleDateString("ru-RU")
                : "—"}
            </span>
          </div>
          <div className="space-y-1.5">
            <Label>Новая дата истечения</Label>
            <Input
              type="date"
              value={newExpiresAt}
              onChange={(e) => setNewExpiresAt(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => shift(7)}>+7 дн</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => shift(14)}>+14 дн</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => shift(30)}>+30 дн</Button>
          </div>
          {subscription.status === "closed" && (
            <p className="text-xs text-muted-foreground">
              Пакет был закрыт по истечении. После продления он снова станет активным.
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохранение..." : "Продлить"}
            </Button>
          </DialogFooter>
        </form>
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
          <AddSubscriptionDialog clientId={clientId} wards={wards} subscriptions={subs} onSuccess={handleSubUpdated} />
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
                <TableHead>Ребёнок</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Группа</TableHead>
                <TableHead>Период</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Полная стоимость</TableHead>
                <TableHead className="text-right">К оплате</TableHead>
                <TableHead className="text-right">Оплачено</TableHead>
                <TableHead className="text-right">Отработано</TableHead>
                <TableHead className="text-right">Остаток</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s) => {
                const paid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0)
                const balance = Number(s.balance)
                const finalAmount = Number(s.finalAmount)
                const lessonPrice = Number(s.lessonPrice) || 0
                const chargedAmount = Number(s.chargedAmount) || 0
                // Subscription.balance / chargedAmount хранятся в ₽; занятие списывает
                // ровно lessonPrice, поэтому делением получаем целое число занятий.
                const usedLessons = lessonPrice > 0 ? Math.round(chargedAmount / lessonPrice) : 0
                const remainingLessons = Math.max(0, s.totalLessons - usedLessons)
                const canEdit = s.status === "pending" || s.status === "active"
                const wardLabel = s.ward ? formatWardName(s.ward) : null
                return (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">
                      {s.ward ? (
                        <Link href={`/crm/wards/${s.ward.id}`} className="hover:underline">
                          {wardLabel}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{s.direction.name}</TableCell>
                    <TableCell>{s.group.name}</TableCell>
                    <TableCell>{formatSubPeriod(s)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[s.status] || ""}`}>
                        {STATUS_LABELS[s.status] || s.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatMoney(finalAmount)}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
                      {balance > 0 ? formatMoney(balance) : "Оплачен"}
                    </TableCell>
                    <TableCell className="text-right text-green-600">
                      {paid > 0 ? formatMoney(paid) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {usedLessons} / {s.totalLessons}
                    </TableCell>
                    <TableCell className={`text-right text-sm font-medium ${remainingLessons === 0 ? "text-muted-foreground" : ""}`}>
                      {remainingLessons}
                    </TableCell>
                    <TableCell>
                      {canEdit && (
                        <div className="flex items-center justify-end gap-0.5">
                          {balance > 0 && (s.status === "pending" || s.status === "active") && (
                            <PayFromBalanceDialog
                              subscription={s}
                              clientId={clientId}
                              onSuccess={handleSubUpdated}
                            />
                          )}
                          <EditSubscriptionDialog subscription={s} onSuccess={handleSubUpdated} />
                          {s.type === "package" && (
                            <ExtendPackageDialog subscription={s} onSuccess={handleSubUpdated} />
                          )}
                          <CloseSubscriptionDialog subscription={s} onSuccess={handleSubUpdated} />
                          <WithdrawSubscriptionDialog subscription={s} onSuccess={handleSubUpdated} />
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
  branchId: string
  branch?: { id: string; name: string } | null
  templates: { dayOfWeek: number }[]
}

interface PackageTemplateOption {
  id: string
  lessonsCount: number
  validDays: number | null
}

type SubscriptionTypeMode = "calendar" | "package"

function AddSubscriptionDialog({
  clientId,
  wards,
  subscriptions,
  onSuccess,
}: {
  clientId: string
  wards: Ward[]
  subscriptions: Subscription[]
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directions, setDirections] = useState<DirectionOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])

  // Тип абонемента организации + связанные данные (для package).
  const [subscriptionType, setSubscriptionType] = useState<SubscriptionTypeMode>("calendar")
  const [packageTemplates, setPackageTemplates] = useState<PackageTemplateOption[]>([])
  const [packageDefaultValidDays, setPackageDefaultValidDays] = useState(60)
  const [packageTemplateId, setPackageTemplateId] = useState("")
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [validDays, setValidDays] = useState("")

  // SUB-12: абонементы с положительным балансом для авто-предложения переноса
  const subsWithBalance = subscriptions.filter(s =>
    Number(s.balance) > 0 && (s.status === "closed" || s.status === "churned")
  )

  const [branchId, setBranchId] = useState("")
  const [directionId, setDirectionId] = useState("")
  const [groupId, setGroupId] = useState("")
  const [wardId, setWardId] = useState("")
  const [periodYear, setPeriodYear] = useState(String(new Date().getFullYear()))
  const [periodMonth, setPeriodMonth] = useState(String(new Date().getMonth() + 1))
  const [lessonPrice, setLessonPrice] = useState("")
  const [totalLessons, setTotalLessons] = useState("")

  // Загрузка направлений, групп, типа абонемента и шаблонов при открытии
  useEffect(() => {
    if (!open) return
    async function load() {
      try {
        const [dirRes, grpRes, orgRes, tplRes] = await Promise.all([
          fetch("/api/directions"),
          fetch("/api/groups"),
          fetch("/api/organization"),
          fetch("/api/package-templates"),
        ])
        if (dirRes.ok) setDirections(await dirRes.json())
        if (grpRes.ok) setGroups(await grpRes.json())
        if (orgRes.ok) {
          const org = await orgRes.json()
          const t = org?.subscriptionType === "package" ? "package" : "calendar"
          setSubscriptionType(t)
          if (typeof org?.packageDefaultValidDays === "number") {
            setPackageDefaultValidDays(org.packageDefaultValidDays)
          }
        }
        if (tplRes.ok) setPackageTemplates(await tplRes.json())
      } catch { /* ignore */ }
    }
    load()
  }, [open])

  // При выборе филиала — сбрасываем направление и группу.
  function handleBranchChange(id: string) {
    setBranchId(id)
    setDirectionId("")
    setGroupId("")
  }

  // При выборе направления — установить цену
  function handleDirectionChange(id: string) {
    setDirectionId(id)
    setGroupId("")
    const dir = directions.find(d => d.id === id)
    if (dir) setLessonPrice(String(Number(dir.lessonPrice)))
  }

  // Авто-подсчёт количества занятий: только для calendar — по календарному месяцу группы.
  useEffect(() => {
    if (subscriptionType !== "calendar") return
    if (!groupId || !periodYear || !periodMonth) return
    const group = groups.find(g => g.id === groupId)
    if (!group) return
    const year = Number(periodYear)
    const month = Number(periodMonth)
    const scheduleDays = group.templates.map(t => t.dayOfWeek)
    let count = 0
    const daysInMonth = new Date(year, month, 0).getDate()
    for (let day = 1; day <= daysInMonth; day++) {
      const dow = new Date(year, month - 1, day).getDay()
      // В schema dayOfWeek: 0=пн, 1=вт... JS: 0=вс, 1=пн...
      const ourDow = dow === 0 ? 6 : dow - 1
      if (scheduleDays.includes(ourDow)) count++
    }
    setTotalLessons(String(count || 1))
  }, [subscriptionType, groupId, periodYear, periodMonth, groups])

  // Для package: при выборе шаблона — автозаполнение totalLessons и validDays.
  useEffect(() => {
    if (subscriptionType !== "package") return
    if (!packageTemplateId) return
    const tpl = packageTemplates.find(t => t.id === packageTemplateId)
    if (tpl) {
      setTotalLessons(String(tpl.lessonsCount))
      setValidDays(tpl.validDays ? String(tpl.validDays) : "")
    }
  }, [subscriptionType, packageTemplateId, packageTemplates])

  function reset() {
    setBranchId("")
    setDirectionId("")
    setGroupId("")
    setWardId("")
    setPeriodYear(String(new Date().getFullYear()))
    setPeriodMonth(String(new Date().getMonth() + 1))
    setLessonPrice("")
    setTotalLessons("")
    setPackageTemplateId("")
    setStartDate(new Date().toISOString().slice(0, 10))
    setValidDays("")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!branchId) { setError("Выберите филиал"); return }
    if (!directionId) { setError("Выберите направление"); return }
    if (!groupId) { setError("Выберите группу"); return }
    if (!lessonPrice || Number(lessonPrice) <= 0) { setError("Укажите цену занятия"); return }
    if (!totalLessons || Number(totalLessons) <= 0) { setError("Укажите кол-во занятий"); return }

    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        clientId,
        directionId,
        groupId,
        wardId: wardId || undefined,
        lessonPrice: Number(lessonPrice),
        totalLessons: Number(totalLessons),
      }
      if (subscriptionType === "package") {
        payload.startDate = startDate
        if (packageTemplateId) payload.packageTemplateId = packageTemplateId
        if (validDays) payload.validDays = Number(validDays)
      } else {
        payload.periodYear = Number(periodYear)
        payload.periodMonth = Number(periodMonth)
      }
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  // Список филиалов выводим из групп — нет смысла предлагать филиал, в котором
  // нет ни одной группы. Дедуплицируем по id.
  const branchOptions: { id: string; name: string }[] = []
  {
    const seen = new Set<string>()
    for (const g of groups) {
      if (!g.branchId || seen.has(g.branchId)) continue
      seen.add(g.branchId)
      branchOptions.push({ id: g.branchId, name: g.branch?.name ?? "Без названия" })
    }
    branchOptions.sort((a, b) => a.name.localeCompare(b.name, "ru"))
  }
  // Направление показываем только то, в котором есть группы выбранного филиала.
  const branchDirectionIds = branchId
    ? new Set(groups.filter(g => g.branchId === branchId).map(g => g.directionId))
    : null
  const filteredDirections = branchDirectionIds
    ? directions.filter(d => branchDirectionIds.has(d.id))
    : directions
  const filteredGroups = directionId && branchId
    ? groups.filter(g => g.directionId === directionId && g.branchId === branchId)
    : []
  const totalAmount = (Number(lessonPrice) || 0) * (Number(totalLessons) || 0)

  const selectedBranch = branchOptions.find(b => b.id === branchId)
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

          {subsWithBalance.length > 0 && (
            <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200">
              <p className="font-medium">Есть остаток на предыдущих абонементах:</p>
              {subsWithBalance.map(s => (
                <p key={s.id} className="mt-1">
                  {s.direction.name}
                  {s.periodYear && s.periodMonth ? ` (${s.periodMonth}/${s.periodYear})` : ""}
                  {" — "}
                  <b>{formatMoney(Number(s.balance))}</b>
                </p>
              ))}
              <p className="mt-1.5 text-xs text-blue-600 dark:text-blue-300">
                Закройте предыдущий абонемент кнопкой ✕ — остаток вернётся на баланс родителя.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Филиал *</Label>
            <Select value={branchId} onValueChange={(v) => { if (v) handleBranchChange(v) }}>
              <SelectTrigger className="w-full">
                {selectedBranch ? selectedBranch.name : "Выберите филиал"}
              </SelectTrigger>
              <SelectContent>
                {branchOptions.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Направление *</Label>
            <Select
              value={directionId}
              onValueChange={(v) => { if (v) handleDirectionChange(v) }}
              disabled={!branchId}
            >
              <SelectTrigger className="w-full">
                {selectedDirection ? selectedDirection.name : branchId ? "Выберите направление" : "Сначала выберите филиал"}
              </SelectTrigger>
              <SelectContent>
                {filteredDirections.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Группа *</Label>
            <Select value={groupId} onValueChange={(v) => { if (v) setGroupId(v) }} disabled={!directionId}>
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
                  {selectedWard ? formatWardName(selectedWard) : "Не выбран"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Не выбран</SelectItem>
                  {wards.map(w => (
                    <SelectItem key={w.id} value={w.id}>
                      {formatWardName(w)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {subscriptionType === "calendar" && (
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
          )}

          {subscriptionType === "package" && (
            <div className="space-y-3">
              {packageTemplates.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Шаблон пакета</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {packageTemplates.map(tpl => (
                      <button
                        type="button"
                        key={tpl.id}
                        onClick={() => setPackageTemplateId(packageTemplateId === tpl.id ? "" : tpl.id)}
                        className={[
                          "rounded-md border p-2 text-left text-xs transition-colors",
                          packageTemplateId === tpl.id
                            ? "border-primary bg-primary/5"
                            : "border-input hover:bg-muted/50",
                        ].join(" ")}
                      >
                        <div className="font-medium">{tpl.lessonsCount} занятий</div>
                        <div className="text-muted-foreground">
                          {tpl.validDays ?? packageDefaultValidDays} дн.
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Дата начала *</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Срок (дн.)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="3650"
                    placeholder={String(packageDefaultValidDays)}
                    value={validDays}
                    onChange={e => setValidDays(e.target.value)}
                  />
                </div>
              </div>

              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Истекает: {(() => {
                  const days = Number(validDays) || packageDefaultValidDays
                  const d = new Date(startDate)
                  if (Number.isNaN(d.getTime())) return "—"
                  d.setDate(d.getDate() + days)
                  return d.toLocaleDateString("ru-RU")
                })()}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
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
          </div>

          {totalAmount > 0 && (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="flex justify-between font-bold">
                <span>Стоимость:</span>
                <span>{formatMoney(totalAmount)}</span>
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
  trialId?: string | null
  date: string
  startTime: string
  durationMinutes: number
  groupName: string
  directionName: string
  roomName: string
  instructorName: string
  isTrial?: boolean
}

const DAY_NAMES = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]

function formatScheduleDate(iso: string): string {
  const d = new Date(iso)
  const day = DAY_NAMES[d.getDay()]
  return `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} (${day})`
}

function ScheduleTab({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [lessons, setLessons] = useState<ScheduleLesson[]>([])
  const [loading, setLoading] = useState(true)
  const [cancellingTrialId, setCancellingTrialId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/schedule`)
      if (res.ok) setLessons(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { load() }, [load])

  async function cancelTrial(trialId: string) {
    const otherTrials = lessons.filter((l) => l.isTrial && l.trialId && l.trialId !== trialId)
    const isLast = otherTrials.length === 0
    const message = isLast
      ? "Отменить пробное занятие?\n\nЭто единственное пробное у лида — он вернётся в статус «Новый»."
      : "Отменить пробное занятие?"
    if (!confirm(message)) return
    setCancellingTrialId(trialId)
    try {
      const res = await fetch(`/api/trial-lessons/${trialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      })
      if (res.ok) {
        await load()
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Ошибка")
      }
    } catch {
      alert("Ошибка сети")
    } finally {
      setCancellingTrialId(null)
    }
  }

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
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap">{formatScheduleDate(l.date)}</TableCell>
                  <TableCell className="whitespace-nowrap">{l.startTime}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{l.directionName}</Badge>
                    {l.isTrial && (
                      <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                        Пробное
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{l.groupName}</TableCell>
                  <TableCell className="text-muted-foreground">{l.instructorName}</TableCell>
                  <TableCell className="text-muted-foreground">{l.roomName}</TableCell>
                  <TableCell>
                    {l.isTrial && l.trialId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:bg-destructive/10"
                        onClick={() => cancelTrial(l.trialId!)}
                        disabled={cancellingTrialId === l.trialId}
                        title="Отменить пробное"
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                  </TableCell>
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
                const name = formatWardName(w, "")
                return (
                  <div
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                  >
                    <Link href={`/crm/wards/${w.id}`} className="font-medium hover:underline">
                      {name}
                    </Link>
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
        <AttendanceTab clientId={clientId} wards={wards} />
      </TabsContent>

      <TabsContent value="communications">
        <CommunicationFeed clientId={clientId} />
      </TabsContent>

      <TabsContent value="history">
        <ClientHistory clientId={clientId} />
      </TabsContent>
    </Tabs>
  )
}
