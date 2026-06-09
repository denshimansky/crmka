import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { redirect } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft, AlertTriangle } from "lucide-react"
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
            Миграция базы клиентов из 1С и синхронизация остатков
          </p>
        </div>
      </div>

      {/* Предупреждение */}
      <div className="max-w-3xl rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
        <div className="flex gap-3">
          <AlertTriangle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Если вы не уверены — лучше обратитесь в техническую поддержку для импорта
            базы. Ошибка на любом из шагов может затереть клиентов или балансы, после
            этого аккуратно откатить сложно.
          </p>
        </div>
      </div>

      {/* Шаги импорта */}
      <Card className="max-w-3xl">
        <CardContent className="divide-y p-0">
          <ImportRow
            step="Шаг 1"
            title="Подготовить выгрузку 1С"
            description="Берёт сырой «Список лидов.xlsx» из 1С, убирает дубли по приоритету статусов, помечает спорные строки и сохраняет «Список лидов — для импорта.xlsx». В базу пока ничего не пишется — это просто подготовка файла."
            button={<ProcessLeadsButton />}
          />
          <ImportRow
            step="Шаг 2"
            title="Залить контакты и деньги в CRM"
            description="Загружает подготовленный «Список лидов — для импорта.xlsx» (опционально + «деньги.xlsx») в базу: создаёт клиентов, подопечных и проставляет балансы. Этот шаг уже меняет базу."
            button={<SyncBalanceButton />}
          />
          <ImportRow
            step="Точечно"
            title="Обновить остатки уже залитой базы"
            description="Точечная корректировка балансов уже существующих клиентов из «остатки.xlsx» (нужны колонки Телефон и Баланс на сегодня). Баланс устанавливается ровно к значению из файла — повторный запуск с тем же файлом ничего не меняет. Клиенты не создаются, в ДДС не пишется. Используйте, если на шаге 2 деньги не загрузились или приехал свежий снимок остатков."
            button={<SyncBalancesButton />}
          />
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

function ImportRow({
  step,
  title,
  description,
  button,
}: {
  step: string
  title: string
  description: string
  button: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
      <div className="sm:w-56 sm:shrink-0">{button}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {step}
        </div>
        <div className="mt-0.5 font-medium">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
