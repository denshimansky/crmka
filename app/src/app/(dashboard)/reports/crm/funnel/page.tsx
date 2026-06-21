import { PageHelp } from "@/components/page-help"
import { MonthPicker } from "@/components/month-picker"
import { getMonthFromParams } from "@/lib/month-params"
import { getSession } from "@/lib/session"
import { computeSalesFunnel, summarizeSalesFunnel } from "@/lib/reports/sales-funnel"
import { branchScopeFromSession } from "@/lib/branch-scope"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { SalesFunnelReport } from "./funnel-report"

// CRM-13 «Воронка продаж»: событийная воронка по заявкам за месяц.
// Вкладки «новые»/«действующие», схемы «с пробным»/«без», разрезы
// «текущий месяц»/«перетекающие», клик по этапу — детализация.
export default async function FunnelReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const role = session.user.role

  const { year, month } = getMonthFromParams(await searchParams)
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

  // ADM-04: сотрудник с ограничением по филиалам видит только свои заявки/лидов.
  const scope = branchScopeFromSession(session.user.allowedBranchIds)
  const data = await computeSalesFunnel(tenantId, year, month, { scope })

  // Телефоны в детализации — по политике видимости (инструктор не видит).
  for (const tab of [data.new, data.existing]) {
    for (const scheme of tab) {
      for (const stage of scheme.stages) {
        for (const row of stage.rows) {
          row.phone = maskPhone(row.phone, role)
        }
      }
    }
  }

  const summary = summarizeSalesFunnel(data)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Воронка продаж</h1>
            <PageHelp pageKey="reports/crm/funnel" />
          </div>
          <p className="text-sm text-muted-foreground">
            Заявки по этапам: лид → заявка → пробное → покупка
          </p>
        </div>
        <MonthPicker />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Период:</span>
        <Badge variant="outline">{monthName}</Badge>
      </div>

      {/* Суммарные цифры месяца (текущие + перетекающие) + конверсия между этапами.
          У каждой карточки — её доля от БАЗОВОГО этапа (не всегда от соседней слева):
          «Купили» считаем от «Заявок», а не от «Пришли на пробное», потому что
          «Купили» (won) суммируется по обеим схемам — с пробным и без, — а «Пришли
          на пробное» (trial_attended) есть только в схеме «с пробным». Деление на
          «Пришли» смешало бы популяции и могло дать >100%. «Заявки» же и «Купили»
          считаются на одной базе (обе схемы, новые + действующие).
          «Лиды» считаются только по новым контактам, поэтому конверсия «Заявки от
          лидов» оценочная и тоже может превышать 100% (заявки подают и действующие). */}
      {(() => {
        const byKey = new Map<string, (typeof summary)[number]>(summary.map((s) => [s.key, s]))
        const leadCount = byKey.get("lead")?.count ?? 0
        const wonCount = byKey.get("won")?.count ?? 0
        // База конверсии каждой карточки: этап-знаменатель + подпись в род. падеже.
        const convBase: Record<string, { baseKey: string; word: string; note?: string }> = {
          application: {
            baseKey: "lead",
            word: "от лидов",
            note: "Оценочно: «Лиды» — только новые контакты, а «Заявки» подают и действующие клиенты, поэтому доля может превышать 100%",
          },
          trial: { baseKey: "application", word: "от заявок" },
          trial_attended: { baseKey: "trial", word: "от пробных" },
          won: {
            baseKey: "application",
            word: "от заявок",
            note: "Доля заявок, завершившихся покупкой. В «Купили» входят и покупки без пробного, поэтому это НЕ конверсия из пришедших на пробное",
          },
        }
        return (
          <>
            <div className="grid gap-4 sm:grid-cols-5">
              {summary.map((s) => {
                const cfg = convBase[s.key]
                const base = cfg ? byKey.get(cfg.baseKey) : undefined
                const baseCount = base?.count ?? 0
                const conv = cfg && baseCount > 0 ? Math.round((s.count / baseCount) * 100) : null
                return (
                  <Card key={s.key}>
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                      <p className="text-2xl font-bold">{s.count}</p>
                      {!cfg ? (
                        <p className="mt-1 text-xs text-muted-foreground">Вход воронки</p>
                      ) : (
                        <p
                          className="mt-1 text-xs text-muted-foreground"
                          title={
                            conv === null
                              ? `Нет данных по этапу «${base?.label ?? cfg.baseKey}»`
                              : `${s.count} из ${baseCount} («${base?.label ?? cfg.baseKey}»)` +
                                (cfg.note ? `. ${cfg.note}` : "")
                          }
                        >
                          {conv === null ? (
                            "—"
                          ) : (
                            <>
                              <span className="font-semibold text-foreground">{conv}%</span> {cfg.word}
                            </>
                          )}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Итоговая конверсия воронки: купили / лиды (оценочно — см. title) */}
            {leadCount > 0 && (
              <div
                className="text-sm text-muted-foreground"
                title="Оценочно: «Купили» включает покупки действующих клиентов (допродажи/возвраты), которых нет среди «Лидов», поэтому показатель может превышать 100%"
              >
                Итоговая конверсия{" "}
                <span className="font-medium text-foreground">Лид → Купил</span>:{" "}
                <span className="font-semibold text-foreground">
                  {Math.round((wonCount / leadCount) * 100)}%
                </span>{" "}
                <span className="text-xs">
                  ({wonCount} из {leadCount})
                </span>
              </div>
            )}
          </>
        )
      })()}

      <SalesFunnelReport data={data} />
    </div>
  )
}
