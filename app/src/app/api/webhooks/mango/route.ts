import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

interface MangoWebhook {
  entry_id: string
  call_direction: number // 1 = incoming, 2 = outgoing
  from: string
  to: string
  duration: number
  recording?: string
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get("tenant")

  if (!tenantId) {
    return NextResponse.json({ error: "Missing tenant" }, { status: 400 })
  }

  // Найти интеграцию
  const integration = await db.integrationConfig.findUnique({
    where: { tenantId_provider: { tenantId, provider: "mango" } },
  })

  if (!integration || !integration.isActive) {
    return NextResponse.json({ error: "Integration not found or inactive" }, { status: 404 })
  }

  const body: MangoWebhook = await req.json()

  // Определяем номер клиента (для входящих — from, для исходящих — to)
  const isIncoming = body.call_direction === 1
  const clientPhone = isIncoming ? body.from : body.to

  if (!clientPhone) {
    return NextResponse.json({ error: "No phone number" }, { status: 400 })
  }

  const phone = clientPhone.replace(/\D/g, "")

  // Поиск клиента
  const client = await db.client.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      OR: [
        { phone: { contains: phone.slice(-10) } },
        { phone2: { contains: phone.slice(-10) } },
      ],
    },
    select: { id: true },
  })

  if (!client) {
    console.log(`[mango webhook] Client not found for phone ${phone}, tenant ${tenantId}`)
    return NextResponse.json({ ok: true, created: false, reason: "client_not_found" })
  }

  await db.communication.create({
    data: {
      tenantId,
      clientId: client.id,
      type: isIncoming ? "call_incoming" : "call_outgoing",
      channel: "phone",
      direction: isIncoming ? "incoming" : "outgoing",
      externalId: body.entry_id,
      metadata: {
        duration: body.duration,
        recordUrl: body.recording || null,
      },
    },
  })

  return NextResponse.json({ ok: true, created: true })
}
