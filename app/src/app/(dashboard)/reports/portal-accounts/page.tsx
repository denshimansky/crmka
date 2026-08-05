import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { formatPhone } from "@/lib/phone"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { KeyRound, UserCheck, LogIn } from "lucide-react"
import { PageHelp } from "@/components/page-help"
import Link from "next/link"

// passwordIssuedAt/lastLoginAt — реальные timestamptz, а это серверный компонент
// (контейнер живёт в UTC). Форматируем в московском времени — бизнес-стандарт РФ,
// иначе «последний вход» уезжает на 3 часа и у событий около полуночи — не тот день.
function fmtDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Moscow" })
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  })
}

export default async function PortalAccountsReportPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()

  // Учётки ЛК видимых (по скоупу филиалов) неудалённых клиентов. Пароль хранится
  // только как bcrypt-хэш — показать его нельзя, поэтому в отчёте только логин,
  // дата выдачи пароля, последний вход и статус доступа.
  const accounts = await db.clientPortalAccount.findMany({
    where: {
      tenantId,
      client: { deletedAt: null, ...scopeClientByBranch(scope) },
    },
    select: {
      id: true,
      loginPhone: true,
      isActive: true,
      passwordIssuedAt: true,
      lastLoginAt: true,
      client: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ isActive: "desc" }, { lastLoginAt: { sort: "desc", nulls: "last" } }],
  })

  const total = accounts.length
  const active = accounts.filter((a) => a.isActive).length
  const loggedIn = accounts.filter((a) => a.lastLoginAt).length

  const summary = [
    { title: "Всего доступов", value: total, icon: KeyRound, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "Активных", value: active, icon: UserCheck, color: "text-green-600", bg: "bg-green-50" },
    { title: "Заходили в ЛК", value: loggedIn, icon: LogIn, color: "text-purple-600", bg: "bg-purple-50" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Личные кабинеты</h1>
          <PageHelp pageKey="reports/portal-accounts" />
        </div>
        <p className="text-sm text-muted-foreground">
          Кому выдан доступ в личный кабинет: логин, дата выдачи пароля и последний вход
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {summary.map((s) => (
          <Card key={s.title}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-lg ${s.bg}`}>
                <s.icon className={`size-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.title}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Пароль хранится в зашифрованном виде и в отчёте не показывается — он виден один раз при выдаче.
        Если пароль утерян, перевыпустите его в карточке клиента (кнопка «Доступ в ЛК»).
      </p>

      {total === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            Доступ в личный кабинет пока никому не выдан.
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Логин</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Пароль выдан</TableHead>
                <TableHead>Последний вход</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => {
                const name = [a.client.lastName, a.client.firstName].filter(Boolean).join(" ") || "Без имени"
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">
                      <Link href={`/crm/clients/${a.client.id}`} className="text-primary hover:underline">
                        {name}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatPhone(a.loginPhone)}</TableCell>
                    <TableCell>
                      {a.isActive ? (
                        <Badge variant="outline" className="border-green-200 text-green-700">Активен</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Отключён</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(a.passwordIssuedAt)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.lastLoginAt ? fmtDateTime(a.lastLoginAt) : "ещё не входил"}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
