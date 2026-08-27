import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { scopePayment, scopeBookableAccount } from "@/lib/branch-scope"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Wallet, Banknote, CreditCard, Undo2 } from "lucide-react"
import Link from "next/link"
import { AddPaymentDialog } from "./add-payment-dialog"
import { RefundPaymentDialog } from "./refund-payment-dialog"
import { EditPaymentDialog } from "./edit-payment-dialog"
import { DeletePaymentDialog } from "./delete-payment-dialog"
import { PageHelp } from "@/components/page-help"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { hasPermission, type RolePermissions } from "@/lib/permissions"
import { formatMoney as fmtCurrency } from "@/lib/currency"

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Наличные",
  bank_transfer: "Безнал",
  acquiring: "Эквайринг",
  online_yukassa: "ЮKassa",
  online_robokassa: "Робокасса",
  sbp_qr: "СБП",
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()
  // Список оплат — по клиенту (scopePayment). Список счетов для форм создания/
  // возврата/редактирования оплаты — «на что можно провести» (scopeBookableAccount):
  // общий счёт остаётся выбираемым, чтобы админ мог записать безнал клиента,
  // хотя его баланс/карточка на «Кассе» скрыты.
  const paymentScope = scopePayment(scope)
  const accountScope = scopeBookableAccount(scope)

  // Начало и конец месяца (UTC для корректного сравнения с DATE)
  const { year, month } = getMonthFromParams(await searchParams)
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0))

  // Только реальные движения денег с клиентами. Платежи type='transfer_in' —
  // это внутреннее списание с баланса родителя в счёт абонемента (через кнопку
  // «Списать»); они не двигают счёт и не относятся к «оплатам». Их видно в ДДС
  // отдельной парой и в карточке клиента (timeline + история баланса).
  const payments = await db.payment.findMany({
    where: {
      tenantId,
      deletedAt: null,
      type: { not: "transfer_in" },
      date: { gte: monthStart, lte: monthEnd },
      ...paymentScope,
    },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      subscription: {
        select: {
          id: true,
          periodYear: true,
          periodMonth: true,
          direction: { select: { name: true } },
        },
      },
      account: { select: { id: true, name: true } },
    },
    orderBy: { date: "desc" },
    take: 200,
  })

  // Считаем суммы
  const incomingPayments = payments.filter(p => p.type !== "refund")
  const refundPayments = payments.filter(p => p.type === "refund")
  const totalIncoming = incomingPayments.reduce((sum, p) => sum + Number(p.amount), 0)
  const totalRefunds = refundPayments.reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0)
  const byCash = incomingPayments.filter(p => p.method === "cash").reduce((sum, p) => sum + Number(p.amount), 0)
  const byAcquiring = incomingPayments.filter(p => p.method === "acquiring" || p.method === "bank_transfer").reduce((sum, p) => sum + Number(p.amount), 0)
  const byOnline = incomingPayments.filter(p => ["online_yukassa", "online_robokassa", "sbp_qr"].includes(p.method)).reduce((sum, p) => sum + Number(p.amount), 0)

  const summary = [
    { title: "Поступления", value: totalIncoming, icon: Wallet, color: "text-green-600", bg: "bg-green-50" },
    { title: "Возвраты", value: totalRefunds, icon: Undo2, color: "text-red-600", bg: "bg-red-50" },
    { title: "Наличные", value: byCash, icon: Banknote, color: "text-emerald-600", bg: "bg-emerald-50" },
    { title: "Безнал / Эквайринг", value: byAcquiring, icon: CreditCard, color: "text-blue-600", bg: "bg-blue-50" },
  ]

  // Клиентов в браузер не отдаём: комбобоксы оплаты/возврата ищут по мере ввода
  // через /api/clients/search (серверный режим, status=payable + телефон) —
  // фильтр «не архив/ЧС» и branch-scope применяются на сервере. Раньше грузили
  // всю базу (take:10000) только ради подстрочного поиска в форме.
  const accounts = await db.financialAccount.findMany({
    where: { tenantId, deletedAt: null, ...accountScope },
    select: { id: true, name: true, type: true },
    orderBy: { createdAt: "asc" },
  })

  // Категории доходов для прочих поступлений (без клиента/абонемента).
  const incomeCategories = await db.incomeCategory.findMany({
    where: {
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
    select: { id: true, name: true, isSystem: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })

  const monthName = monthStart.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })

  // Редактировать оплаты могут только владелец и управляющий — на случай
  // ошибки администратора.
  const canEdit = session.user.role === "owner" || session.user.role === "manager"
  // Удаление оплат — отдельное право: владелец всегда, управляющему включается
  // в матрице прав (Настройки → Права ролей).
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { rolePermissions: true, currency: true },
  })
  const currency = org?.currency ?? "RUB"
  const formatMoney = (amount: number): string => fmtCurrency(amount, currency)
  const canDelete = hasPermission(
    session.user.role,
    "payments.delete",
    (org?.rolePermissions as RolePermissions | null) ?? null,
  )
  const accountOptions = accounts.map(a => ({ id: a.id, name: a.name, type: a.type }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex flex-wrap items-center gap-4 gap-y-2">
          <h1 className="text-2xl font-bold">Оплаты</h1>
          <PageHelp pageKey="finance/payments" />
          <MonthPicker />
        </div>
        <div className="flex flex-wrap gap-2">
          <RefundPaymentDialog
            accounts={accounts.map(a => ({ id: a.id, name: a.name, type: a.type }))}
          />
          <AddPaymentDialog
            accounts={accounts.map(a => ({ id: a.id, name: a.name, type: a.type }))}
            incomeCategories={incomeCategories.map(c => ({ id: c.id, name: c.name }))}
          />
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summary.map((s) => (
          <Card key={s.title}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-lg ${s.bg}`}>
                <s.icon className={`size-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.title}</p>
                <p className="text-lg font-bold">{formatMoney(s.value)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {payments.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет оплат за текущий месяц
          </CardContent>
        </Card>
      ) : (
        <StickyHScroll className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Клиент</TableHead>
                <TableHead>Назначение</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead>Способ</TableHead>
                <TableHead>Счёт</TableHead>
                {(canEdit || canDelete) && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => {
                const clientName = p.client
                  ? [p.client.lastName, p.client.firstName].filter(Boolean).join(" ") || "Без имени"
                  : "Прочий доход"
                const isRefund = p.type === "refund"
                const subInfo = p.subscription
                  ? `${p.subscription.direction.name} (${String(p.subscription.periodMonth).padStart(2, "0")}.${p.subscription.periodYear})`
                  : p.comment || "—"
                const amt = Number(p.amount)
                return (
                  <TableRow key={p.id} className={isRefund ? "bg-red-50/50 dark:bg-red-950/10" : undefined}>
                    <TableCell className="text-muted-foreground">{formatDate(p.date)}</TableCell>
                    <TableCell className="font-medium">
                      {p.client ? (
                        <Link
                          href={`/crm/clients/${p.client.id}`}
                          className="text-primary hover:underline"
                        >
                          {clientName}
                        </Link>
                      ) : (
                        clientName
                      )}
                      {isRefund && (
                        <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">Возврат</Badge>
                      )}
                    </TableCell>
                    <TableCell>{subInfo}</TableCell>
                    <TableCell className={`text-right font-medium ${isRefund ? "text-red-600" : "text-green-600"}`}>
                      {isRefund ? `−${formatMoney(Math.abs(amt))}` : formatMoney(amt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{METHOD_LABELS[p.method] || p.method}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.account.name}</TableCell>
                    {(canEdit || canDelete) && (
                      <TableCell className="p-1">
                        {/* Возвраты редактируются/удаляются, КРОМЕ исторических,
                            привязанных к абонементу (subscriptionId): их правка
                            разъехала бы «Оплачено» закрытого абонемента (API это
                            тоже блокирует). Обычные оплаты с абонементом — можно. */}
                        {!(isRefund && p.subscription) && (
                        <div className="flex items-center gap-0.5">
                          {canEdit && (
                            <EditPaymentDialog
                              payment={{
                                id: p.id,
                                amount: Number(p.amount),
                                method: p.method,
                                date: p.date.toISOString(),
                                accountId: p.account.id,
                                comment: p.comment,
                                isRefund,
                                isOtherIncome: p.incomeCategoryId != null,
                                notInPnl: p.notInPnl,
                              }}
                              accounts={accountOptions}
                            />
                          )}
                          {canDelete && (
                            <DeletePaymentDialog
                              payment={{
                                id: p.id,
                                amount: amt,
                                date: p.date.toISOString(),
                                clientName: p.client ? clientName : null,
                                accountName: p.account.name,
                                isRefund,
                              }}
                            />
                          )}
                        </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </StickyHScroll>
      )}
    </div>
  )
}
