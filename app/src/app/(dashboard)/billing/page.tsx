"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  CreditCard, FileText, Building2, Calendar, Receipt, TrendingUp, Clock,
} from "lucide-react"

interface Plan {
  id: string
  name: string
  pricePerBranch: string
  description: string | null
}

interface Subscription {
  id: string
  status: string
  branchCount: number
  monthlyAmount: string
  billingPeriodMonths: number
  nextPaymentDate: string
  periodEndDate: string | null
  startDate: string
  plan: Plan
}

interface Invoice {
  id: string
  number: string
  amount: string
  status: string
  periodStart: string
  periodEnd: string
  dueDate: string
  paidAt: string | null
  paidAmount: string | null
}

interface BillingData {
  organization: {
    id: string
    name: string
    legalName: string | null
    inn: string | null
    billingStatus: string
  }
  subscription: Subscription | null
  invoices: Invoice[]
  stats: {
    totalPaid: number
    invoicesPaid: number
    branchCount: number
  }
}

const SUB_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  active: { label: "Активна", variant: "default" },
  grace_period: { label: "Грейс-период", variant: "secondary" },
  blocked: { label: "Заблокирована", variant: "destructive" },
  cancelled: { label: "Отменена", variant: "outline" },
}

const INV_STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Ожидает оплаты", variant: "secondary" },
  paid: { label: "Оплачен", variant: "default" },
  overdue: { label: "Просрочен", variant: "destructive" },
  cancelled: { label: "Отменён", variant: "outline" },
}

const PERIOD_OPTIONS = [
  { months: 1, label: "1 мес" },
  { months: 3, label: "3 мес" },
  { months: 6, label: "6 мес" },
  { months: 12, label: "12 мес" },
]

export default function BillingPage() {
  const { data: session } = useSession()
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedPeriod, setSelectedPeriod] = useState(1)
  const [periodSaving, setPeriodSaving] = useState(false)
  const [periodError, setPeriodError] = useState("")

  useEffect(() => {
    fetch("/api/billing")
      .then((r) => {
        if (!r.ok) throw new Error("Нет доступа")
        return r.json()
      })
      .then((d) => {
        setData(d)
        if (d.subscription?.billingPeriodMonths) {
          setSelectedPeriod(d.subscription.billingPeriodMonths)
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const role = (session?.user as any)?.role

  if (loading) return <div className="text-muted-foreground">Загрузка...</div>

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          {role !== "owner" && role !== "manager"
            ? "Раздел доступен только для владельца и управляющего"
            : error || "Не удалось загрузить данные"}
        </p>
      </div>
    )
  }

  const { organization, subscription, invoices, stats } = data
  const ss = subscription ? (SUB_STATUS[subscription.status] || { label: subscription.status, variant: "outline" as const }) : null

  const pricePerBranch = subscription ? Number(subscription.plan.pricePerBranch) : 0
  const branchCount = subscription ? subscription.branchCount : stats.branchCount
  const calculatedAmount = pricePerBranch * branchCount * selectedPeriod

  const handlePeriodChange = async () => {
    if (!subscription) return
    setPeriodSaving(true)
    setPeriodError("")
    try {
      const res = await fetch("/api/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingPeriodMonths: selectedPeriod }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Ошибка обновления")
      }
      const { subscription: updated } = await res.json()
      setData((prev) =>
        prev ? { ...prev, subscription: updated } : prev,
      )
    } catch (e: any) {
      setPeriodError(e.message)
    } finally {
      setPeriodSaving(false)
    }
  }

  const periodChanged = subscription && selectedPeriod !== subscription.billingPeriodMonths

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Подписка</h1>
        <p className="text-sm text-muted-foreground">Управление подпиской и счетами</p>
      </div>

      {/* Карточки-метрики */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CreditCard className="size-4" />Тариф
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscription ? (
              <>
                <div className="text-2xl font-bold">{subscription.plan.name}</div>
                <div className="text-sm text-muted-foreground">
                  {Number(subscription.plan.pricePerBranch).toLocaleString("ru")} ₽/филиал
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">Нет подписки</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Receipt className="size-4" />К оплате
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {subscription ? `${Number(subscription.monthlyAmount).toLocaleString("ru")} ₽` : "—"}
            </div>
            <div className="text-sm text-muted-foreground">
              {subscription ? `${subscription.branchCount} филиал(ов)` : ""}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="size-4" />Следующая оплата
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {subscription
                ? new Date(subscription.nextPaymentDate).toLocaleDateString("ru")
                : "—"}
            </div>
            {ss && <Badge variant={ss.variant} className="mt-1">{ss.label}</Badge>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="size-4" />Всего оплачено
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Number(stats.totalPaid).toLocaleString("ru")} ₽
            </div>
            <div className="text-sm text-muted-foreground">
              {stats.invoicesPaid} счёт(ов)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Период оплаты */}
      {subscription && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" />Период оплаты
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.months}
                  type="button"
                  onClick={() => setSelectedPeriod(opt.months)}
                  className={`rounded-lg border-2 p-4 text-center transition-colors cursor-pointer ${
                    selectedPeriod === opt.months
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="text-lg font-bold">{opt.label}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {(pricePerBranch * branchCount * opt.months).toLocaleString("ru")} ₽
                  </div>
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">
                  Итого: {pricePerBranch.toLocaleString("ru")} ₽ × {branchCount} филиал(ов) × {selectedPeriod} мес
                </div>
                <div className="text-xl font-bold">
                  {calculatedAmount.toLocaleString("ru")} ₽
                </div>
                {subscription.periodEndDate && (
                  <div className="text-sm text-muted-foreground">
                    Оплачено до: <span className="font-medium text-foreground">{new Date(subscription.periodEndDate).toLocaleDateString("ru")}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Button
                  onClick={handlePeriodChange}
                  disabled={!periodChanged || periodSaving}
                >
                  {periodSaving ? "Сохранение..." : "Изменить период"}
                </Button>
                {periodError && (
                  <p className="text-sm text-destructive">{periodError}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Детали подписки */}
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4" />Организация
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Название:</span>
              <span>{organization.name}</span>
            </div>
            {organization.legalName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Юрлицо:</span>
                <span>{organization.legalName}</span>
              </div>
            )}
            {organization.inn && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">ИНН:</span>
                <span>{organization.inn}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Филиалов:</span>
              <span>{stats.branchCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-4" />Подписка
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {subscription ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Тариф:</span>
                  <span>{subscription.plan.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Период:</span>
                  <span>{subscription.billingPeriodMonths} мес.</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Сумма за период:</span>
                  <span>{Number(subscription.monthlyAmount).toLocaleString("ru")} ₽</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Филиалов:</span>
                  <span>{subscription.branchCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Дата начала:</span>
                  <span>{new Date(subscription.startDate).toLocaleDateString("ru")}</span>
                </div>
                {subscription.periodEndDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Оплачено до:</span>
                    <span className="font-medium">{new Date(subscription.periodEndDate).toLocaleDateString("ru")}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Следующая оплата:</span>
                  <span className="font-medium">{new Date(subscription.nextPaymentDate).toLocaleDateString("ru")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Статус:</span>
                  {ss && <Badge variant={ss.variant}>{ss.label}</Badge>}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">Нет активной подписки. Обратитесь к поддержке.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Счета */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="size-4" />История счетов
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Номер</TableHead>
                <TableHead>Период</TableHead>
                <TableHead>Сумма</TableHead>
                <TableHead>Оплата до</TableHead>
                <TableHead>Оплачен</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => {
                const is = INV_STATUS[inv.status] || { label: inv.status, variant: "outline" as const }
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.number}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(inv.periodStart).toLocaleDateString("ru")} — {new Date(inv.periodEnd).toLocaleDateString("ru")}
                    </TableCell>
                    <TableCell>{Number(inv.amount).toLocaleString("ru")} ₽</TableCell>
                    <TableCell className="text-sm">{new Date(inv.dueDate).toLocaleDateString("ru")}</TableCell>
                    <TableCell className="text-sm">
                      {inv.paidAt ? (
                        <span>{new Date(inv.paidAt).toLocaleDateString("ru")} — {Number(inv.paidAmount).toLocaleString("ru")} ₽</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell><Badge variant={is.variant}>{is.label}</Badge></TableCell>
                  </TableRow>
                )
              })}
              {invoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Нет счетов
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Футер с ссылкой на оферту */}
      <div className="text-center text-xs text-muted-foreground pt-2">
        <a href="/offer" target="_blank" rel="noopener noreferrer" className="hover:underline">
          Договор-оферта
        </a>
      </div>
    </div>
  )
}
