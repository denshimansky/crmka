"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import { Plus, Pencil, Ban, CalendarDays, Undo2, CalendarPlus } from "lucide-react"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { AddWardForm } from "./add-ward-form"
import { AttendanceTab } from "./attendance-tab"
import { PayFromBalanceDialog } from "./pay-from-balance-dialog"
import { CommunicationFeed } from "@/components/communication-feed"
import { ClientHistory } from "./client-history"
import { formatWardName } from "@/lib/format-name"
import { formatAge } from "@/lib/age"
import { useRoleNames } from "@/components/role-names-provider"
import { useMoneyFormat, useCurrencySymbol } from "@/components/currency-provider"
import { EditPackageLessonsDialog } from "@/app/(dashboard)/crm/_components/edit-package-lessons-dialog"

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
  startDate?: string | null
  expiresAt?: string | null
  lessonPrice: string
  totalLessons: number
  totalAmount: string
  finalAmount: string
  balance: string
  chargedAmount: string
  /** Скидки v3: выбранный пер-абонементный шаблон (scope=subscription). */
  discountTemplateId?: string | null
  /** Источник текущей скидки (none/type1/type2/legacy). */
  discountSource?: string
  direction: { id: string; name: string }
  group: { id: string; name: string }
  ward: { id: string; firstName: string; lastName: string | null } | null
  payments: { id: string; amount: string; date: string; method: string }[]
  /** Возвращено на баланс клиента при закрытии абонемента (subscription_closed_refund). */
  refundedToBalance?: number
  /** Скидки v2: число отметок, списавших занятие (включая бесплатные при 100% скидке). */
  attendedLessons?: number
  /** Израсходовано занятий: списывающие отметки + финальные несписывающие
   *  (Уваж. пропуск/Перерасчёт) у календарных — для столбца «Остаток». */
  consumedLessons?: number
  /** Отложенное отчисление: запланированная дата ухода (ISO) или null. */
  scheduledWithdrawalDate?: string | null
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
  startDate?: string | null
  expiresAt?: string | null
  type?: string
}): string {
  if (s.type === "package") {
    // Пакет: показываем явный период старт – окончание, чтобы у партнёров не было
    // вопросов, почему занятия покрываются именно в этих датах.
    const fmt = (iso: string) => new Date(iso).toLocaleDateString("ru-RU")
    const start = s.startDate ? fmt(s.startDate) : null
    const end = s.expiresAt ? fmt(s.expiresAt) : null
    if (start && end) return `${start} – ${end}`
    if (start) return `с ${start}`
    if (end) return `до ${end}`
    return "Пакет"
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
  perSubDiscountMode,
  onSuccess,
}: {
  subscription: Subscription
  perSubDiscountMode: boolean
  onSuccess: () => void
}) {
  const formatMoney = useMoneyFormat()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [lessonPrice, setLessonPrice] = useState(String(Number(subscription.lessonPrice)))
  const [totalLessons, setTotalLessons] = useState(String(subscription.totalLessons))

  // Скидки v3: пер-абонементная скидка этого абонемента. Легаси — заморожена,
  // поле скрыто. Список — только шаблоны scope=subscription (грузим в режиме).
  const discountEditable = subscription.discountSource !== "legacy"
  const [discountTemplates, setDiscountTemplates] = useState<DiscountTemplateOption[]>([])
  const [discountTemplateId, setDiscountTemplateId] = useState(
    subscription.discountTemplateId ?? "none",
  )

  useEffect(() => {
    if (!open || !perSubDiscountMode || !discountEditable) return
    fetch("/api/discount-templates?isActive=true&kind=permanent&scope=subscription")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setDiscountTemplates(Array.isArray(d) ? d : []))
      .catch(() => { /* ignore */ })
  }, [open, perSubDiscountMode, discountEditable])

  function reset() {
    setLessonPrice(String(Number(subscription.lessonPrice)))
    setTotalLessons(String(subscription.totalLessons))
    setDiscountTemplateId(subscription.discountTemplateId ?? "none")
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
          // Скидки v3: пер-абонементный шаблон шлём только в режиме, для не-легаси
          // И только если он РЕАЛЬНО изменён — иначе правка одной цены не должна
          // трогать «доживающую» скидку (сервер пойдёт по repriceSubscription).
          ...(perSubDiscountMode &&
          discountEditable &&
          discountTemplateId !== (subscription.discountTemplateId ?? "none")
            ? { discountTemplateId: discountTemplateId === "none" ? null : discountTemplateId }
            : {}),
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
  // Скидки v3: предпросчёт стоимости со скидкой выбранного шаблона (percent от цены).
  const discLabel = (t: DiscountTemplateOption) =>
    t.valueType === "percent"
      ? `${t.name} — ${t.value}%`
      : `${t.name} — −${formatMoney(t.value)}/зан.`
  const selTpl = discountTemplates.find((t) => t.id === discountTemplateId)
  const priceNum = Number(lessonPrice) || 0
  const discPerLesson = selTpl
    ? Math.min(selTpl.valueType === "percent" ? (priceNum * selTpl.value) / 100 : selTpl.value, priceNum)
    : 0
  const discountedTotal = Math.max(0, priceNum - discPerLesson) * (Number(totalLessons) || 0)

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

          {/* Скидки v3: пер-абонементный шаблон. Легаси — скрыто (заморожено). */}
          {discountEditable && (
            <div className="space-y-1.5">
              <Label>Шаблон скидки на абонемент</Label>
              {perSubDiscountMode ? (
                <Select value={discountTemplateId} onValueChange={(v) => { if (v) setDiscountTemplateId(v) }}>
                  <SelectTrigger className="w-full">
                    {selTpl ? discLabel(selTpl) : "Не применять никакую"}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Не применять никакую</SelectItem>
                    {discountTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{discLabel(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {/* Скидки v3: «доживающая» клиентская скидка (без пер-абон. шаблона)
                  показывается «Не применять» — поясняем, чтобы не путать. */}
              {perSubDiscountMode &&
                !subscription.discountTemplateId &&
                (subscription.discountSource === "type1" ||
                  subscription.discountSource === "type2") && (
                  <p className="text-xs text-muted-foreground">
                    На абонементе действует прежняя скидка (доживает до конца периода).
                    Выберите шаблон, чтобы заменить её.
                  </p>
                )}
              {!perSubDiscountMode && (
                <>
                  <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground">
                    Недоступно
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Включите режим «Шаблоны скидок на абонементы» в карточке клиента.
                  </p>
                </>
              )}
            </div>
          )}

          {totalAmount > 0 && (
            <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
              {perSubDiscountMode && discountEditable && selTpl && discPerLesson > 0 ? (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Стоимость без скидки:</span>
                    <span>{formatMoney(totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                    <span>Скидка «{selTpl.name}»</span>
                    <span>−{formatMoney(totalAmount - discountedTotal)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t border-border pt-1">
                    <span>Итого:</span>
                    <span>{formatMoney(discountedTotal)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between font-bold">
                  <span>Стоимость:</span>
                  <span>{formatMoney(totalAmount)}</span>
                </div>
              )}
              {(subscription.attendedLessons ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground pt-1">
                  Уже отмеченные занятия сохранят своё списание — итоговая сумма может
                  отличаться от расчётной.
                </p>
              )}
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
  // Причина блокировки отчисления по статусу занятия (незакрытая отработка и
  // т.п.). Не null → отчислять нельзя, кнопка заблокирована.
  withdrawalBlockReason?: string | null
  // Дата последнего платного занятия (yyyy-MM-dd) — предлагается как дата
  // отчисления по умолчанию. null → платных посещений нет.
  lastPaidDate: string | null
  hasPaidAttendance: boolean
  // Начало абонемента (yyyy-MM-dd) — нижняя граница для поля даты отчисления.
  startDate: string
  // Конец периода абонемента (yyyy-MM-dd) — верхняя граница (будущую дату в
  // пределах периода можно: отложенное отчисление).
  periodEnd: string
  // Сегодня по серверу (yyyy-MM-dd) — граница immediate/scheduled.
  today: string
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
  const formatMoney = useMoneyFormat()
  const sym = useCurrencySymbol()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<WithdrawPreview | null>(null)
  const [reasons, setReasons] = useState<WithdrawalReasonOption[]>([])
  const [reasonId, setReasonId] = useState<string>("")
  const [comment, setComment] = useState<string>("")

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
      setComment("")
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
        body: JSON.stringify({
          status: "withdrawn",
          withdrawalReasonId: reasonId,
          withdrawalComment: comment.trim() || undefined,
        }),
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
                      : `0 ${sym}`}
                </span>
              </div>
            </div>

            <div className="rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-3 text-sm text-yellow-800 dark:text-yellow-200 space-y-1.5">
              <p>
                Ребёнок будет <b>отчислен из группы</b>: на последнем платном занятии
                он остаётся в составе, а из более поздних пропадёт (прошедшие
                посещения сохранятся).
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

            {preview.withdrawalBlockReason && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
                {preview.withdrawalBlockReason}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Дата отчисления</Label>
              {preview.hasPaidAttendance && preview.lastPaidDate ? (
                <>
                  <p className="text-sm font-medium">
                    {new Date(preview.lastPaidDate).toLocaleDateString("ru-RU")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Назначается автоматически — дата последнего платного занятия.
                    После неё ученик не показывается в составе группы.
                  </p>
                </>
              ) : (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  У абонемента нет платных занятий — датой отчисления будет дата
                  создания абонемента. Такой абонемент не попадёт в отток.
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

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: переезд, потеря интереса, детали договорённости…"
                rows={2}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Сохранится в истории коммуникаций клиента.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                onClick={handleWithdraw}
                disabled={loading || !reasonId || !!preview.withdrawalBlockReason}
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

// ===== Scheduled withdrawal badge (отложенное отчисление) =====

function ScheduledWithdrawalBadge({
  subscription,
  onSuccess,
}: {
  subscription: Subscription
  onSuccess: () => void
}) {
  const [loading, setLoading] = useState(false)
  if (!subscription.scheduledWithdrawalDate) return null
  const dateLabel = new Date(subscription.scheduledWithdrawalDate).toLocaleDateString("ru-RU")

  async function cancel() {
    if (!confirm(`Отменить запланированное отчисление на ${dateLabel}?`)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/subscriptions/${subscription.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelScheduledWithdrawal: true }),
      })
      if (res.ok) onSuccess()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-1 flex items-center gap-1">
      <span
        className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
        title="Отчисление запланировано: ребёнок ходит до этой даты, расчёт — в этот день по факту посещений"
      >
        Отчисление {dateLabel}
      </span>
      <button
        type="button"
        onClick={cancel}
        disabled={loading}
        className="text-[11px] text-muted-foreground underline hover:text-foreground disabled:opacity-50"
      >
        Отменить
      </button>
    </div>
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

function SubscriptionsTab({ clientId, wards, perSubDiscountMode }: { clientId: string; wards: Ward[]; perSubDiscountMode: boolean }) {
  const formatMoney = useMoneyFormat()
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
        </div>
      </CardHeader>
      <CardContent>
        {loadingSubs ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Загрузка...</p>
        ) : subs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Нет абонементов</p>
        ) : (
          <StickyHScroll className="rounded-md border">
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
                const paidIn = s.payments.reduce((sum, p) => sum + Number(p.amount), 0)
                // «Оплачено» = внесено минус возвращённое на баланс при закрытии:
                // отчисленный с полным возвратом не должен выглядеть оплаченным.
                const refunded = Number(s.refundedToBalance) || 0
                const paid = Math.max(0, paidIn - refunded)
                const balance = Number(s.balance)
                const finalAmount = Number(s.finalAmount)
                // Скидки v2: «отхожено» приходит с сервера числом отметок —
                // цены занятий внутри абонемента могут различаться (скидка
                // применяется к оставшимся занятиям), деление сумм не работает.
                const usedLessons = s.attendedLessons ?? 0
                // Остаток — по израсходованным слотам: Уваж. пропуск/Перерасчёт
                // расходуют занятие календарного абонемента без списания.
                const remainingLessons = Math.max(
                  0,
                  s.totalLessons - (s.consumedLessons ?? usedLessons)
                )
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
                    <TableCell>
                      <Link
                        href={`/schedule/groups/${s.group.id}`}
                        className="text-primary hover:underline"
                      >
                        {s.group.name}
                      </Link>
                    </TableCell>
                    <TableCell>{formatSubPeriod(s)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[s.status] || ""}`}>
                        {STATUS_LABELS[s.status] || s.status}
                      </span>
                      {(s.status === "active" || s.status === "pending") && s.scheduledWithdrawalDate && (
                        <ScheduledWithdrawalBadge subscription={s} onSuccess={handleSubUpdated} />
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {formatMoney(finalAmount)}
                    </TableCell>
                    {s.status === "withdrawn" ||
                    (s.status === "closed" && balance === 0 && paid === 0 &&
                      (s.consumedLessons ?? usedLessons) === 0) ? (
                      // Отчисленному и аннулированному (закрыт без оплат и
                      // посещений, напр. автозакрытием неоплаченных) нечего
                      // «оплачивать»: balance обнулён закрытием, зелёный
                      // «Оплачен» здесь вводил в заблуждение. Закрытый с
                      // непогашенным остатком (истёкший пакет) продолжает
                      // показывать красную сумму — он и в должниках. Абонемент
                      // из одних уваж. пропусков — состоявшийся, не аннулирован.
                      <TableCell className="text-right text-muted-foreground">—</TableCell>
                    ) : (
                      <TableCell className={`text-right font-medium ${balance > 0 ? "text-red-600" : "text-green-600"}`}>
                        {balance > 0 ? formatMoney(balance) : "Оплачен"}
                      </TableCell>
                    )}
                    <TableCell
                      className={`text-right ${paid > 0 ? "text-green-600" : "text-muted-foreground"}`}
                      title={
                        refunded > 0
                          ? `Внесено ${formatMoney(paidIn)}, возвращено на баланс ${formatMoney(refunded)}`
                          : undefined
                      }
                    >
                      {paid > 0 ? formatMoney(paid) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {/* Знаменатель — эффективное число занятий: отработанные +
                          остаток. Несписывающий расход (уваж. пропуск/перерасчёт)
                          возвращает деньги на баланс и выпадает из абонемента,
                          поэтому «второе число» уменьшается на такие занятия
                          (usedLessons + remaining = totalLessons − выпавшие). */}
                      {usedLessons} / {usedLessons + remainingLessons}
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
                          <EditSubscriptionDialog subscription={s} perSubDiscountMode={perSubDiscountMode} onSuccess={handleSubUpdated} />
                          {s.type === "package" && (
                            <ExtendPackageDialog subscription={s} onSuccess={handleSubUpdated} />
                          )}
                          {s.type === "package" && (
                            <EditPackageLessonsDialog subscriptionId={s.id} onSuccess={handleSubUpdated} />
                          )}
                          <WithdrawSubscriptionDialog subscription={s} onSuccess={handleSubUpdated} />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </StickyHScroll>
        )}
      </CardContent>
    </Card>
  )
}

// ===== Payments Tab =====

interface BalanceTxnRow {
  id: string
  type: string
  label: string
  amount: number
  date: string
  detail: string
}

function BalanceOperationsTab({ clientId }: { clientId: string }) {
  const formatMoney = useMoneyFormat()
  const router = useRouter()
  const [txns, setTxns] = useState<BalanceTxnRow[]>([])
  const [loadingTxns, setLoadingTxns] = useState(true)
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

  const loadTxns = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/balance-transactions`)
      if (res.ok) setTxns(await res.json())
    } catch { /* ignore */ }
    finally { setLoadingTxns(false) }
  }, [clientId])

  useEffect(() => { loadTxns() }, [loadTxns])

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
      loadTxns()
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
          <CardTitle className="text-base">Операции с балансом ({txns.length})</CardTitle>
          <Button variant="outline" size="sm" onClick={openRefundDialog}>
            <Undo2 className="mr-1 size-3.5" />
            Возврат
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loadingTxns ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Загрузка...</p>
        ) : txns.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Нет операций с балансом</p>
        ) : (
          <StickyHScroll className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Операция</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {txns.map((t) => {
                // amount &gt;= 0 — приход на баланс (зелёный «+»), &lt; 0 — списание (красный «−»).
                const credit = t.amount >= 0
                return (
                  <TableRow key={t.id} className={credit ? undefined : "bg-red-50/40 dark:bg-red-950/10"}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(t.date)}</TableCell>
                    <TableCell>
                      <div className="font-medium">{t.label}</div>
                      {t.detail && <div className="text-xs text-muted-foreground">{t.detail}</div>}
                    </TableCell>
                    <TableCell className={`whitespace-nowrap text-right font-medium ${credit ? "text-green-600" : "text-red-600"}`}>
                      {credit ? "+" : "−"}{formatMoney(Math.abs(t.amount))}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          </StickyHScroll>
        )}
        {txns.length === 300 && (
          <p className="pt-3 text-center text-xs text-muted-foreground">Показаны последние 300 операций</p>
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

// Скидки v3: пер-абонементный шаблон скидки (scope=subscription) для формы.
interface DiscountTemplateOption {
  id: string
  name: string
  valueType: "percent" | "fixed"
  value: number
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
  const roleNames = useRoleNames()
  const [lessons, setLessons] = useState<ScheduleLesson[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/schedule`)
      if (res.ok) setLessons(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { load() }, [load])

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
          <StickyHScroll className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Время</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Группа</TableHead>
                <TableHead>{roleNames.instructor}</TableHead>
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
                    {l.isTrial && (
                      <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                        Пробное
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{l.groupName}</TableCell>
                  <TableCell className="text-muted-foreground">{l.instructorName}</TableCell>
                  <TableCell className="text-muted-foreground">{l.roomName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </StickyHScroll>
        )}
      </CardContent>
    </Card>
  )
}

// ===== Main Component =====

export function ClientTabs({
  clientId,
  wards,
  perSubDiscountMode,
}: {
  clientId: string
  wards: Ward[]
  // Скидки v3: клиент в режиме «Шаблоны скидок на абонементы» — форма абонемента
  // показывает выбор пер-абонементного шаблона.
  perSubDiscountMode: boolean
}) {
  return (
    <Tabs defaultValue="wards">
      {/* Мобилка: полоса вкладок фиксированной высоты (h-8) не переносится без
          наложения — прокручиваем по горизонтали. pb-1.5 — чтобы подчёркивание
          активной вкладки (after:bottom-[-5px]) не обрезалось overflow. */}
      <div className="max-w-full overflow-x-auto pb-1.5">
        <TabsList variant="line">
          <TabsTrigger value="wards">Подопечные</TabsTrigger>
          <TabsTrigger value="subscriptions">Абонементы</TabsTrigger>
          <TabsTrigger value="payments">Операции с балансом</TabsTrigger>
          <TabsTrigger value="schedule">Расписание</TabsTrigger>
          <TabsTrigger value="attendance">Посещения</TabsTrigger>
          <TabsTrigger value="communications">Коммуникации</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
        </TabsList>
      </div>

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
                        ? `${formatDate(w.birthDate)} (${formatAge(w.birthDate)})`
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
        <SubscriptionsTab clientId={clientId} wards={wards} perSubDiscountMode={perSubDiscountMode} />
      </TabsContent>

      <TabsContent value="payments">
        <BalanceOperationsTab clientId={clientId} />
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
