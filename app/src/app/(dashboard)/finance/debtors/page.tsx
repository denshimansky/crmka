import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertTriangle, Users } from "lucide-react"
import Link from "next/link"
import { PageHelp } from "@/components/page-help"
import { ReportExport } from "@/components/report-export"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function formatDate(date: Date | null): string {
  if (!date) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export default async function DebtorsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()
  const clientScope = scopeClientByBranch(scope)

  // Должник = клиент с отрицательным балансом ИЛИ с активным/pending
  // абонементом с непогашенным остатком (subscription.balance > 0).
  // ADM-04: сегментный scope.
  const debtors = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      OR: [
        { clientBalance: { lt: 0 } },
        {
          subscriptions: {
            some: {
              deletedAt: null,
              status: { in: ["active", "pending"] },
              balance: { gt: 0 },
            },
          },
        },
      ],
      ...(Object.keys(clientScope).length > 0 ? clientScope : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      clientBalance: true,
      promisedPaymentDate: true,
      firstPaymentDate: true,
      phone: true,
      branch: { select: { name: true } },
      subscriptions: {
        where: { deletedAt: null, status: { in: ["active", "pending"] } },
        select: {
          direction: { select: { name: true } },
          balance: true,
        },
        take: 5,
      },
      payments: {
        where: { deletedAt: null },
        orderBy: { date: "desc" },
        take: 1,
        select: { date: true },
      },
    },
  })

  // Источники долга: группируем транзакции по абонементу/направлению.
  // Каждой строчке должника покажем разбивку «по чему он должен» — это даёт
  // ответ на вопрос «откуда долг», который раньше можно было только догадаться.
  const debtorIds = debtors.map((d) => d.id)
  const txns = debtorIds.length
    ? await db.clientBalanceTransaction.findMany({
        where: { tenantId, clientId: { in: debtorIds } },
        select: {
          clientId: true,
          amount: true,
          type: true,
          subscriptionId: true,
          subscription: {
            select: {
              periodYear: true,
              periodMonth: true,
              direction: { select: { name: true } },
            },
          },
          direction: { select: { name: true } },
        },
      })
    : []

  type DebtSourceRow = { key: string; label: string; amount: number }
  const sourcesByClient = new Map<string, DebtSourceRow[]>()
  for (const t of txns) {
    const key = t.subscriptionId ?? `direction:${t.direction?.name ?? "—"}`
    const label = t.subscription
      ? `${t.subscription.direction.name} (${String(t.subscription.periodMonth).padStart(2, "0")}.${t.subscription.periodYear})`
      : t.direction?.name ?? "Прочее"
    const list = sourcesByClient.get(t.clientId) ?? []
    const found = list.find((r) => r.key === key)
    const delta = Number(t.amount)
    if (found) {
      found.amount += delta
    } else {
      list.push({ key, label, amount: delta })
    }
    sourcesByClient.set(t.clientId, list)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Полный долг = минус на балансе + сумма непогашенных абонементов.
  // Источники: пункты ledger (от закрытий) + активные неоплаченные абонементы.
  const rows = debtors.map((d) => {
    const name = [d.lastName, d.firstName].filter(Boolean).join(" ") || "Без имени"
    const balanceDebt = Math.max(0, -Number(d.clientBalance))
    const subscriptionsDebt = d.subscriptions.reduce(
      (s, sub) => s + Math.max(0, Number(sub.balance)),
      0,
    )
    const debt = balanceDebt + subscriptionsDebt
    const lastPayment = d.payments[0]?.date || null
    const promised = d.promisedPaymentDate
    const isOverdue = promised && promised < today
    const directions = d.subscriptions.map(s => s.direction.name).join(", ") || "—"
    const branchName = d.branch?.name || "—"
    // Источники: сначала активные абонементы с долгом, потом ledger.
    const subSources: { key: string; label: string; amount: number }[] = d.subscriptions
      .filter((sub) => Number(sub.balance) > 0)
      .map((sub) => ({
        key: `sub:${sub.direction.name}`,
        label: `${sub.direction.name} (абонемент)`,
        amount: -Number(sub.balance),
      }))
    const ledgerSources = (sourcesByClient.get(d.id) ?? []).filter((s) => s.amount < 0)
    const sources = [...subSources, ...ledgerSources]
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 4)

    return { id: d.id, name, debt, balanceDebt, subscriptionsDebt, branchName, directions, lastPayment, promised, isOverdue, phone: d.phone, sources }
  })
  // Сортируем по суммарному долгу убыванию.
  rows.sort((a, b) => b.debt - a.debt)

  const totalDebt = rows.reduce((s, r) => s + r.debt, 0)
  const overdueCount = debtors.filter(d => d.promisedPaymentDate && d.promisedPaymentDate < today).length

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Должники</h1>
        <PageHelp pageKey="finance/debtors" />
        <ReportExport
          title="Должники"
          filename="debtors"
          columns={[
            { header: "Клиент", key: "name", width: 25 },
            { header: "Филиал", key: "branchName", width: 18 },
            { header: "Направление", key: "directions", width: 25 },
            { header: "Долг", key: "debt", width: 14 },
            { header: "Телефон", key: "phone", width: 18 },
          ]}
          rows={rows.map((r) => ({
            name: r.name,
            branchName: r.branchName,
            directions: r.directions,
            debt: r.debt,
            phone: r.phone || "—",
          }))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-red-50">
              <AlertTriangle className="size-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Общий долг</p>
              <p className="text-lg font-bold text-red-600">{formatMoney(totalDebt)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-orange-50">
              <Users className="size-5 text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Должников</p>
              <p className="text-lg font-bold">{debtors.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-red-50">
              <AlertTriangle className="size-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Просрочено</p>
              <p className="text-lg font-bold text-red-600">{overdueCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет должников
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Источник долга</TableHead>
                <TableHead className="text-right">Долг</TableHead>
                <TableHead>Последняя оплата</TableHead>
                <TableHead>Обещанная дата</TableHead>
                <TableHead>Телефон</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/crm/clients/${r.id}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.branchName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.sources.length === 0 ? (
                      <span>{r.directions}</span>
                    ) : (
                      <div className="space-y-0.5">
                        {r.sources.map((s) => (
                          <div key={s.key} className="flex items-baseline gap-2 text-xs">
                            <span className="text-foreground">{s.label}</span>
                            <span className="text-red-600 tabular-nums">−{formatMoney(Math.abs(s.amount))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium text-red-600">{formatMoney(r.debt)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.lastPayment)}</TableCell>
                  <TableCell>
                    {r.promised ? (
                      <span className={r.isOverdue ? "font-medium text-red-600" : ""}>
                        {formatDate(r.promised)}
                        {r.isOverdue && <Badge variant="destructive" className="ml-2 text-xs">просрочено</Badge>}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
