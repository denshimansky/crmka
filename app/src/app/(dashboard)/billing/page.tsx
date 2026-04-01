"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  CreditCard, FileText, Building2, Calendar, Receipt, TrendingUp,
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
  nextPaymentDate: string
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

export default function BillingPage() {
  const { data: session } = useSession()
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/billing")
      .then((r) => {
        if (!r.ok) throw new Error("Нет доступа")
        return r.json()
      })
      .then(setData)
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
                  <span className="text-muted-foreground">Сумма/мес:</span>
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
    </div>
  )
}
