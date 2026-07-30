import { redirect } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Wallet, BookOpen, Calendar, Clock } from "lucide-react"
import {
  getCabinetSession,
  getPortalClient,
  getWardSubscriptions,
  getWardSchedule,
  getWardBranchContacts,
  isValidWardKey,
} from "@/lib/portal-data"
import { formatMoney } from "@/lib/currency"
import { BranchContactsCard } from "../../_components/branch-contacts"

// Обзор подопечного: баланс клиента, абонементы, ближайшие занятия, контакты.

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]

function money(value: number, currency: string) {
  return formatMoney(value, currency)
}

function periodLabel(sub: {
  type: string
  periodYear: number | null
  periodMonth: number | null
  expiresAt: Date | null
  endDate: Date | null
}) {
  if (sub.periodYear && sub.periodMonth) {
    const label = new Date(sub.periodYear, sub.periodMonth - 1, 1).toLocaleDateString("ru", {
      month: "long",
      year: "numeric",
    })
    return label.replace(" г.", "")
  }
  if (sub.expiresAt) return `действует до ${sub.expiresAt.toLocaleDateString("ru")}`
  if (sub.endDate) return `до ${sub.endDate.toLocaleDateString("ru")}`
  return null
}

export default async function WardOverviewPage({
  params,
}: {
  params: Promise<{ slug: string; wardId: string }>
}) {
  const { slug, wardId } = await params
  const cabinet = await getCabinetSession(slug)
  if (!cabinet) redirect(`/p/${slug}`)
  if (!cabinet.gatePassed) return null

  const { tenantId, clientId } = cabinet.session
  if (!(await isValidWardKey(tenantId, clientId, wardId))) redirect(`/p/${slug}/cabinet`)

  const [client, subscriptions, schedule, branches] = await Promise.all([
    getPortalClient(tenantId, clientId),
    getWardSubscriptions(tenantId, clientId, wardId),
    getWardSchedule(tenantId, clientId, wardId),
    getWardBranchContacts(tenantId, clientId, wardId),
  ])
  if (!client) redirect(`/p/${slug}`)

  const currency = cabinet.org.currency
  const balance = Number(client.clientBalance)

  return (
    <div className="space-y-4">
      {/* Баланс клиента */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="size-4" />
            Баланс
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${balance < 0 ? "text-destructive" : ""}`}>
              {money(balance, currency)}
            </div>
            {balance < 0 && <div className="text-xs text-destructive">Есть задолженность</div>}
          </div>
        </CardContent>
      </Card>

      {/* Абонементы */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <BookOpen className="size-4" />
            Абонементы
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {subscriptions.length === 0 && (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Нет активных абонементов — обратитесь к администратору
            </p>
          )}
          {subscriptions.map((sub) => {
            const period = periodLabel(sub)
            const balanceDue = Number(sub.balance)
            const instructor = sub.group.instructor
            return (
              <div key={sub.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    {sub.direction.color && (
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: sub.direction.color }}
                      />
                    )}
                    {sub.direction.name}
                  </div>
                  <Badge variant={sub.status === "active" ? "default" : "secondary"}>
                    {sub.status === "active" ? "Активен" : "Ожидает оплаты"}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {[
                    sub.group.name,
                    sub.group.branch?.name,
                    instructor && [instructor.lastName, instructor.firstName].filter(Boolean).join(" "),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {period && <span className="capitalize">{period}</span>}
                  <span>
                    осталось {sub.remainingLessons} из {sub.totalLessons}
                  </span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Стоимость {money(Number(sub.finalAmount), currency)} ·{" "}
                  {balanceDue > 0 ? (
                    <span className="font-medium text-destructive">
                      К оплате {money(balanceDue, currency)}
                    </span>
                  ) : (
                    <span className="text-green-600">Оплачен</span>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* Ближайшие занятия */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Calendar className="size-4" />
            Ближайшие занятия
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {schedule.length === 0 && (
            <p className="py-2 text-center text-sm text-muted-foreground">Нет ближайших занятий</p>
          )}
          {schedule.map((lesson) => {
            const d = lesson.date
            return (
              <div key={`${lesson.isTrial ? "t" : "l"}-${lesson.id}`} className="flex items-center gap-3 rounded-md border p-3">
                <div className="w-12 shrink-0 text-center">
                  <div className="text-sm font-medium">
                    {d.toLocaleDateString("ru", { day: "numeric", month: "short" }).replace(".", "")}
                  </div>
                  <div className="text-xs text-muted-foreground">{WEEKDAYS[d.getDay()]}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {lesson.directionName}
                    {lesson.isTrial && <Badge variant="secondary">Пробное</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[lesson.groupName, lesson.roomName, lesson.instructorName]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 text-sm">
                  <Clock className="size-3 text-muted-foreground" />
                  {lesson.startTime}
                  {lesson.durationMinutes ? (
                    <span className="text-xs text-muted-foreground">
                      · {lesson.durationMinutes} мин
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <BranchContactsCard branches={branches} />
    </div>
  )
}
