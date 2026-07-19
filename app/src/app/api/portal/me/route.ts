import { NextResponse } from "next/server"
import { getPortalContext, getPortalClient, getPortalWards } from "@/lib/portal-data"

// GET /api/portal/me — клиент, подопечные, организация (для клиентских компонентов)
export async function GET() {
  const ctx = await getPortalContext()
  if (!ctx.ok) {
    return NextResponse.json({ error: "Forbidden", code: ctx.code }, { status: ctx.status })
  }

  const [client, wards] = await Promise.all([
    getPortalClient(ctx.session.tenantId, ctx.session.clientId),
    getPortalWards(ctx.session.tenantId, ctx.session.clientId),
  ])
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({
    client: {
      id: client.id,
      name: [client.lastName, client.firstName, client.patronymic].filter(Boolean).join(" "),
      phone: client.phone,
      email: client.email,
      clientBalance: Number(client.clientBalance),
    },
    organization: { name: ctx.org.name, inn: ctx.org.inn },
    wards: wards.wards,
    hasSelfProfile: wards.hasSelfProfile,
  })
}
