import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { redirect } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { PageHelp } from "@/components/page-help"
import { ArrowLeft, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { ProcessLeadsButton } from "./process-button"
import { ImportTemplateButton } from "./import-template-button"
import { DownloadTemplateLink } from "./download-template-link"
import { DownloadBalancesTemplateLink } from "./download-balances-template-link"
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
            Перенос клиентской базы по шаблону и синхронизация остатков
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
            title="Подготовить и проверить файл"
            description={
              <>
                <p>
                  Здесь файл готовится и проверяется — в базу пока ничего не
                  пишется.
                </p>
                <ol className="mt-1 list-decimal space-y-1 pl-5">
                  <li>
                    <span className="font-medium">«Скачать шаблон»</span> — откройте
                    лист «Клиенты» и заполните его: по строке на каждого ребёнка.
                    Обязательны «Ребёнок», «Статус» и контакт — телефон или соцсети
                    (если у вас уже есть выгрузка старой базы — этот пункт можно
                    пропустить, загрузив её как есть).
                  </li>
                  <li>
                    <span className="font-medium">«Загрузить и проверить»</span> —
                    выберите заполненный файл. Система уберёт дубли (один ребёнок в
                    нескольких строках → одна строка), сведёт детей одного телефона к
                    одному родителю и пометит спорные строки «Проверить = да».
                  </li>
                  <li>
                    Система сразу <span className="font-medium">скачает вам
                    проверенный файл</span>. Откройте его в Excel, поправьте или
                    удалите строки с пометкой «Проверить = да» (нет контакта или
                    непонятный статус) и сохраните.
                  </li>
                  <li>
                    Готовый файл загрузите на <span className="font-medium">Шаге 2</span>.
                  </li>
                </ol>
              </>
            }
            button={
              <div className="flex flex-col gap-2">
                <ProcessLeadsButton />
                <DownloadTemplateLink />
              </div>
            }
          />
          <ImportRow
            step="Шаг 2"
            title="Залить контакты в CRM"
            description="Загрузите проверенный файл (результат Шага 1 или заполненный шаблон): система создаёт клиентов, их подопечных и привязывает клиентов к филиалу. Дубли строк одного ребёнка схлопываются, дети одного телефона становятся подопечными одного родителя. Балансы этот шаг не грузит — для них Шаг 3. Этот шаг меняет базу."
            button={<ImportTemplateButton />}
          />
          <ImportRow
            step="Шаг 3"
            title="Загрузить балансы (остатки)"
            description="Скачайте шаблон остатков, заполните два столбца — Телефон и Баланс на сегодня — и загрузите. Баланс каждого клиента ставится ровно к значению из файла по телефону (+ депозит, − долг). Клиенты не создаются, в ДДС не пишется, повторная загрузка того же файла ничего не меняет. Так балансы переносятся без риска задвоить сумму."
            button={
              <div className="flex flex-col gap-2">
                <SyncBalancesButton />
                <DownloadBalancesTemplateLink />
              </div>
            }
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
  description: React.ReactNode
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
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}
