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
import { Plus } from "lucide-react"
import { AddWardForm } from "./add-ward-form"

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Абонементы ({subs.length})</CardTitle>
          <AddSubscriptionDialog clientId={clientId} wards={wards} onSuccess={() => { loadSubs(); router.refresh() }} />
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s) => {
                const paid = s.payments.reduce((sum, p) => sum + Number(p.amount), 0)
                const balance = Number(s.balance)
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
  const [payments, setPayments] = useState<Payment[]>([])
  const [loadingPayments, setLoadingPayments] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/payments?clientId=${clientId}`)
        if (res.ok) setPayments(await res.json())
      } catch { /* ignore */ }
      finally { setLoadingPayments(false) }
    }
    load()
  }, [clientId])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Оплаты ({payments.length})</CardTitle>
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
                const subInfo = p.subscription
                  ? `${p.subscription.direction.name} (${String(p.subscription.periodMonth).padStart(2, "0")}.${p.subscription.periodYear})`
                  : p.comment || "—"
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground">{formatDate(p.date)}</TableCell>
                    <TableCell>{subInfo}</TableCell>
                    <TableCell className="text-right font-medium text-green-600">
                      {formatMoney(Number(p.amount))}
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
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="size-4" />
        Абонемент
      </DialogTrigger>
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
        <TabsTrigger value="attendance">Посещения</TabsTrigger>
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

      <TabsContent value="attendance">
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Будет в модуле 5
          </CardContent>
        </Card>
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
