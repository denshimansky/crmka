import { redirect } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Wallet } from "lucide-react"
import { getCabinetSession, getPortalClient } from "@/lib/portal-data"
import { formatMoney } from "@/lib/currency"
import { PaymentsList } from "./payments-list"

// Оплаты — клиентский уровень (деньги на родителе, у оплат нет подопечного).

export default async function CabinetPaymentsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const cabinet = await getCabinetSession(slug)
  if (!cabinet) redirect(`/p/${slug}`)
  if (!cabinet.gatePassed) return null

  const client = await getPortalClient(cabinet.session.tenantId, cabinet.session.clientId)
  if (!client) redirect(`/p/${slug}`)

  const balance = Number(client.clientBalance)

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="size-4" />
            Баланс
          </div>
          <div className="text-right">
            <div className={`text-2xl font-bold ${balance < 0 ? "text-destructive" : ""}`}>
              {formatMoney(balance, cabinet.org.currency)}
            </div>
            {balance < 0 && <div className="text-xs text-destructive">Есть задолженность</div>}
          </div>
        </CardContent>
      </Card>

      <PaymentsList />
    </div>
  )
}
