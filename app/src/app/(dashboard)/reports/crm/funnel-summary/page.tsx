import { getSession, getBranchScope } from "@/lib/session"
import { computeLiveFunnel } from "@/lib/reports/funnel-live"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft } from "lucide-react"
import { BackButton } from "@/components/back-button"
import { PageHelp } from "@/components/page-help"
import { FunnelTree } from "./funnel-tree"

// «Сводная таблица воронки продаж» — снимок «на сейчас» (без выбора месяца):
// активные заявки по этапам воронки в разрезе Филиал → Направление + «Связь».
export default async function FunnelSummaryPage() {
  const session = await getSession()
  const scope = await getBranchScope()
  const data = await computeLiveFunnel(session.user.tenantId, scope)

  const totalApps =
    data.totals.application +
    data.totals.trial_scheduled +
    data.totals.trial_attended +
    data.totals.awaiting_payment

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <BackButton fallbackHref="/reports" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </BackButton>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Сводная таблица воронки продаж</h1>
            <PageHelp pageKey="reports/crm/funnel-summary" />
          </div>
          <p className="text-sm text-muted-foreground">
            Актуальные заявки по этапам воронки в разрезе филиалов и направлений
          </p>
        </div>
        <Badge variant="secondary" className="ml-auto">
          Актуальность: сейчас
        </Badge>
      </div>

      <Card>
        <CardContent className="p-4">
          <FunnelTree branches={data.branches} totals={data.totals} />
          <p className="mt-3 text-xs text-muted-foreground">
            Всего активных заявок: {totalApps}. «Связь» — клиенты с назначенной датой следующего
            контакта (как во вкладке Продажи → Связь): по филиалам разносится по активной заявке, в
            «Всего» — все такие клиенты.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
