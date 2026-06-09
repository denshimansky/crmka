import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { redirect } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { ProcessLeadsButton } from "./process-button"
import { SyncBalanceButton } from "./sync-button"
import { SyncBalancesButton } from "./sync-balances-button"
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
            Двухэтапная миграция базы клиентов из 1С и синхронизация остатков
          </p>
        </div>
      </div>

      <Card className="max-w-3xl">
        <CardContent className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            Сначала — обработка выгрузки лидов, затем заливка контактов в CRM. Если
            клиенты уже залиты без денег — обновите балансы кнопкой «Синхронизировать
            остатки» (в ДДС не пишется).
          </p>

          <div className="flex flex-wrap gap-2">
            <ProcessLeadsButton />
            <SyncBalanceButton />
            <SyncBalancesButton />
            {wipeGate.available && wipeGate.expiresAt && (
              <WipeDatabaseButton
                orgName={org?.name ?? ""}
                expiresAt={wipeGate.expiresAt.toISOString()}
              />
            )}
          </div>

          {!wipeGate.available && (
            <p className="text-xs text-muted-foreground">
              Кнопка «Очистить всю базу» появится после первого успешного импорта и
              доступна 7 дней после него. Сейчас окно недоступно
              {wipeGate.expiresAt
                ? ` (истекло ${wipeGate.expiresAt.toLocaleString("ru-RU")})`
                : " (импортов ещё не было)"}.
              Для очистки после окончания окна — обратитесь в техподдержку.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
