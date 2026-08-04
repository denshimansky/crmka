import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { redirect } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { ImportTemplateButton } from "./import-template-button"
import { DownloadTemplateLink } from "./download-template-link"
import { TEMPLATE_FILENAME } from "./template-meta"
import { WipeDatabaseButton } from "./wipe-button"
import { isWipeAvailable } from "@/lib/leads-import/sync-leads"

export default async function LeadsImportPage() {
  const session = await getSession()
  if (session.user.role !== "owner") {
    redirect("/settings")
  }

  const tenantId = session.user.tenantId
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { name: true },
  })
  const wipeGate = await isWipeAvailable(tenantId)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Импорт базы</h1>
            <PageHelp pageKey="settings/leads-import" />
          </div>
          <p className="text-sm text-muted-foreground">
            Перенос клиентской базы в CRM по готовому шаблону
          </p>
        </div>
      </div>

      {/* Предупреждение */}
      <div className="max-w-3xl rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
        <div className="flex gap-3">
          <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Если вы не уверены — лучше обратитесь в техническую поддержку для импорта
            базы. Ошибка при загрузке может затереть клиентов или балансы, после этого
            аккуратно откатить сложно.
          </p>
        </div>
      </div>

      {/* Импорт по шаблону */}
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
          <div className="flex flex-col gap-2 sm:w-56 sm:shrink-0">
            <ImportTemplateButton />
            <DownloadTemplateLink />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mt-0.5 font-medium">Импорт клиента по шаблону</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Скачайте шаблон «{TEMPLATE_FILENAME}», заполните лист «Клиенты»
              (по строке на каждого ребёнка) и загрузите обратно. Система создаст
              клиентов, их подопечных, проставит балансы из колонки «Баланс» и
              привяжет клиентов к филиалу. Этот шаг меняет базу. Дети с одним
              телефоном становятся подопечными одного клиента-родителя. Филиалы из
              колонки «Филиал» должны быть заранее заведены в CRM с такими же
              названиями.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Wipe — только в окне 7 дней после первого импорта */}
      {wipeGate.available && wipeGate.expiresAt && (
        <Card className="max-w-3xl border-destructive/40">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
            <div className="sm:w-56 sm:shrink-0">
              <WipeDatabaseButton
                orgName={org?.name ?? ""}
                expiresAt={wipeGate.expiresAt.toISOString()}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              Полностью очистить базу — если импорт пошёл не так и хочется начать
              заново. Окно доступа закроется{" "}
              <span className="font-medium text-foreground">
                {wipeGate.expiresAt.toLocaleString("ru-RU")}
              </span>
              . После этого — только через техподдержку.
            </p>
          </CardContent>
        </Card>
      )}

      {!wipeGate.available && (
        <p className="max-w-3xl text-xs text-muted-foreground">
          Кнопка «Очистить всю базу» появится после первого успешного импорта и
          доступна 7 дней. Сейчас окно недоступно
          {wipeGate.expiresAt
            ? ` (истекло ${wipeGate.expiresAt.toLocaleString("ru-RU")})`
            : " (импортов ещё не было)"}
          . Для очистки после окончания окна — обратитесь в техподдержку.
        </p>
      )}
    </div>
  )
}
