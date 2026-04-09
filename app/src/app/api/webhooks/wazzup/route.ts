import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import crypto from "crypto"

interface WazzupMessage {
  chatId: string
  text: string
  type: string
  isFromMe: boolean
  timestamp: number
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get("tenant")

  if (!tenantId) {
    return NextResponse.json({ error: "Missing tenant" }, { status: 400 })
  }

  // Найти интеграцию
  const integration = await db.integrationConfig.findUnique({
    where: { tenantId_provider: { tenantId, provider: "wazzup" } },
  })

  if (!integration || !integration.isActive) {
    return NextResponse.json({ error: "Integration not found or inactive" }, { status: 404 })
  }

  // Верификация подписи
  const signature = req.headers.get("x-webhook-signature") || ""
  if (integration.webhookSecret) {
    const rawBody = await req.text()
    const expected = crypto
      .createHmac("sha256", integration.webhookSecret)
      .update(rawBody)
      .digest("hex")

    if (signature !== expected) {
      console.warn("[wazzup webhook] Invalid signature for tenant", tenantId)
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
    }

    // Re-parse body after reading as text
    const body = JSON.parse(rawBody)
    return await processMessages(body, tenantId)
  }

  const body = await req.json()
  return await processMessages(body, tenantId)
}

async function processMessages(body: { messages?: WazzupMessage[] }, tenantId: string) {
  const messages = body.messages || []

  let created = 0
  for (const msg of messages) {
    // chatId в Wazzup = номер телефона (без +)
    const phone = msg.chatId?.replace(/\D/g, "")
    if (!phone) continue

    // Поиск клиента по телефону (пробуем разные форматы)
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
      console.log(`[wazzup webhook] Client not found for phone ${phone}, tenant ${tenantId}`)
      continue
    }

    await db.communication.create({
      data: {
        tenantId,
        clientId: client.id,
        type: msg.isFromMe ? "whatsapp_outgoing" : "whatsapp_incoming",
        channel: "whatsapp",
        direction: msg.isFromMe ? "outgoing" : "incoming",
        content: msg.text || null,
        externalId: msg.chatId,
        metadata: { messageType: msg.type, timestamp: msg.timestamp },
      },
    })
    created++
  }

  return NextResponse.json({ ok: true, created })
}
