import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

export default async function SystemParamsPage() {
  const session = await getSession()
  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: {
      payForAbsence: true,
      payForTrialLessons: true,
      attendanceDeadline: true,
      debtLimit: true,
      salaryDay1: true,
      salaryDay2: true,
      makeupDaysLimit: true,
      makeupDeadlineDays: true,
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Параметры системы</h1>
            <PageHelp pageKey="settings/system" />
          </div>
          <p className="text-sm text-muted-foreground">
            Базовые правила: оплата педагогам, дедлайны, лимиты, дни выплат
          </p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardContent className="p-6">
          {org ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Оплата инструктору за прогул</span>
                <Badge variant={org.payForAbsence ? "default" : "secondary"}>
                  {org.payForAbsence ? "Да" : "Нет"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Оплата пробных занятий педагогу</span>
                <Badge variant={org.payForTrialLessons ? "default" : "secondary"}>
                  {org.payForTrialLessons ? "Только платные" : "Нет"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Дедлайн отметки посещений</span>
                <span className="text-sm font-medium">{org.attendanceDeadline} дн.</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Лимит долга</span>
                <span className="text-sm font-medium">
                  {org.debtLimit ? `${Number(org.debtLimit).toLocaleString("ru-RU")} ₽` : "Не задан"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Дни выплаты ЗП</span>
                <span className="text-sm font-medium">
                  Аванс: {org.salaryDay1 ?? "---"} / Зарплата: {org.salaryDay2 ?? "---"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Срок отработки (дн.)</span>
                <span className="text-sm font-medium">{org.makeupDaysLimit ?? "Не задан"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Дедлайн отработки (дн.)</span>
                <span className="text-sm font-medium">{org.makeupDeadlineDays ?? "Не задан"}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Организация не найдена</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
