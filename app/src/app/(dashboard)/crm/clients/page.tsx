import { getSession } from "@/lib/session"
import { db } from "@/lib/db"
import { Badge } from "@/components/ui/badge"
import { CreateClientDialog } from "./create-client-dialog"
import { ClientsTable } from "./clients-table"

export default async function ClientsPage() {
  const session = await getSession()
  const tenantId = session.user.tenantId

  const [clients, branches] = await Promise.all([
    db.client.findMany({
      where: { tenantId, deletedAt: null, funnelStatus: "active_client" },
      include: {
        wards: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.branch.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ])

  // Serialize Decimal fields to strings for client component
  const serialized = clients.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    segment: c.segment,
    clientBalance: c.clientBalance.toString(),
    funnelStatus: c.funnelStatus,
    clientStatus: c.clientStatus,
    wards: c.wards.map((w) => ({
      id: w.id,
      firstName: w.firstName,
      lastName: w.lastName,
    })),
    branch: c.branch,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Клиенты</h1>
          <Badge variant="secondary">{clients.length}</Badge>
        </div>
        <CreateClientDialog branches={branches} />
      </div>

      <ClientsTable clients={serialized} />
    </div>
  )
}
