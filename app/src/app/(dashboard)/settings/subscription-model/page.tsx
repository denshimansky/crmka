import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Card, CardContent } from "@/components/ui/card"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft, Lock, Tag, BookOpen, FileText, BarChart3, ExternalLink } from "lucide-react"
import Link from "next/link"
import { UnpaidAutoCloseForm } from "../unpaid-auto-close-form"
import { PackageTemplatesContent } from "../package-templates-content"

export default async function SubscriptionModelPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: {
      subscriptionType: true,
      subscriptionTypeLockedAt: true,
      unpaidSubscriptionAutoCloseDays: true,
      packageDefaultValidDays: true,
      packageExpiryNotifyDaysBefore: true,
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
            <h1 className="text-2xl font-bold">Абонементы</h1>
            <PageHelp pageKey="settings/subscription-model" />
          </div>
          <p className="text-sm text-muted-foreground">
            Модель работы (календарный / пакетный / фикс) и автозакрытие неоплаченных
          </p>
        </div>
      </div>

      {!org ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Организация не найдена
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2">
                <Tag className="size-5 text-primary" />
                <h2 className="text-lg font-semibold">Модель работы с абонементами</h2>
              </div>

              <div className="rounded-md border bg-muted/40 p-4">
                <div className="text-xs text-muted-foreground">Текущий тип</div>
                <div className="mt-1 text-lg font-medium">
                  {org.subscriptionType === "calendar" && "Календарный"}
                  {org.subscriptionType === "package" && "Пакетный"}
                  {org.subscriptionType === "fixed" && "Фикс"}
                  {!org.subscriptionType && (
                    <span className="text-muted-foreground">Не выбран</span>
                  )}
                </div>
                {org.subscriptionType === "calendar" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Каждый месяц — отдельный абонемент. Цена считается по числу
                    занятий в группе на месяц.
                  </p>
                )}
                {org.subscriptionType === "package" && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    N занятий на срок M дней. Клиент посещает в любое доступное
                    время в выбранной группе.
                  </p>
                )}
              </div>

              {org.subscriptionTypeLockedAt ? (
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex gap-2">
                    <Lock className="size-4 shrink-0 text-muted-foreground" />
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Тип заблокирован</div>
                      <p className="text-xs text-muted-foreground">
                        С {new Date(org.subscriptionTypeLockedAt).toLocaleDateString("ru-RU")}.
                        Смена типа влияет на работу всей системы (отчёты, ЗП, биллинг)
                        — поэтому разблокировать может только техподдержка.
                        Напишите на <a href="mailto:support@umnayacrm.ru" className="text-primary hover:underline">support@umnayacrm.ru</a>.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Тип ещё не зафиксирован. Будет автоматически заблокирован после
                  создания первого абонемента.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <UnpaidAutoCloseForm initialValue={org.unpaidSubscriptionAutoCloseDays} />
            </CardContent>
          </Card>

          {org.subscriptionType === "package" && (
            <>
              <div className="md:col-span-2">
                <PackageTemplatesContent
                  initialDefaultValidDays={org.packageDefaultValidDays}
                  initialNotifyDaysBefore={org.packageExpiryNotifyDaysBefore}
                />
              </div>

              <div className="md:col-span-2">
                <Card>
                  <CardContent className="space-y-3 p-6">
                    <div className="flex items-center gap-2">
                      <BookOpen className="size-5 text-primary" />
                      <h2 className="text-lg font-semibold">Справочные материалы</h2>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <a
                        href="/help/package-subscriptions"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"
                      >
                        <span className="flex items-center gap-2">
                          <FileText className="size-4 text-muted-foreground" />
                          Инструкция по пакетным абонементам
                        </span>
                        <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                      </a>
                      <a
                        href="/internal-docs/package-reports"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"
                      >
                        <span className="flex items-center gap-2">
                          <BarChart3 className="size-4 text-muted-foreground" />
                          Методика отчётов при пакетном типе
                        </span>
                        <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                      </a>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      «Инструкция» открыта по прямой ссылке — её можно отправить сотрудникам без
                      входа в CRM. «Методика отчётов» — внутренняя, открывается только после входа.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
