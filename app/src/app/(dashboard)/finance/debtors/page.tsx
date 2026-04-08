import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertTriangle, Users } from "lucide-react"
import Link from "next/link"
import { PageHelp } from "@/components/page-help"

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

  // Клиенты с отрицательным балансом
  const debtors = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      clientBalance: { lt: 0 },
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
        where: { deletedAt: null, status: "active" },
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
    orderBy: { clientBalance: "asc" }, // самый большой долг первым
  })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const totalDebt = debtors.reduce((s, d) => s + Math.abs(Number(d.clientBalance)), 0)
  const overdueCount = debtors.filter(d => d.promisedPaymentDate && d.promisedPaymentDate < today).length

  const rows = debtors.map((d) => {
    const name = [d.lastName, d.firstName].filter(Boolean).join(" ") || "Без имени"
    const debt = Math.abs(Number(d.clientBalance))
    const lastPayment = d.payments[0]?.date || null
    const promised = d.promisedPaymentDate
    const isOverdue = promised && promised < today
    const directions = d.subscriptions.map(s => s.direction.name).join(", ") || "—"
    const branchName = d.branch?.name || "—"

    return { id: d.id, name, debt, branchName, directions, lastPayment, promised, isOverdue, phone: d.phone }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Должники</h1>
        <PageHelp pageKey="finance/debtors" />
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
                <TableHead>Направление</TableHead>
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
                  <TableCell className="text-muted-foreground">{r.directions}</TableCell>
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
