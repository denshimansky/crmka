import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import crypto from "crypto"
import { findClientsByPhone } from "@/lib/clients/find-by-phone"
import { buildMessageExternalId } from "@/lib/ext/chat-identity"

interface WazzupMessage {
  chatId: string
  text: string
  type: string
  isFromMe: boolean
  timestamp: number
  /** Идентификатор самого сообщения — ключ дедупликации при повторной доставке. */
  messageId?: string
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
  let skipped = 0
  for (const msg of messages) {
    // chatId в Wazzup = номер телефона (без +)
    if (!msg.chatId) continue

    // Поиск клиента по телефону единой точкой: findClientsByPhone нормализует
    // ХРАНИМЫЙ номер на стороне БД, поэтому «+7 (999) 12-34-56» находится так же,
    // как «89991234 56». Прежний `phone contains last-10` по сырой строке
    // форматированные номера не находил, и сообщения молча терялись.
    const matches = await findClientsByPhone(db, tenantId, msg.chatId, { limit: 2 })
    if (matches.length === 0) {
      console.log(`[wazzup webhook] Client not found for chat ${msg.chatId}, tenant ${tenantId}`)
      continue
    }
    // Несколько клиентов с одним номером (семья, дубли) — записать сообщение
    // произвольному было бы хуже, чем не записать: чужая переписка в карточке.
    if (matches.length > 1) {
      console.log(
        `[wazzup webhook] Ambiguous phone ${msg.chatId} (${matches.length} clients), tenant ${tenantId}`,
      )
      continue
    }

    // Ключ идемпотентности — id СООБЩЕНИЯ (в паре с чатом), а не chatId: раньше
    // сюда клали телефон чата, и при повторной доставке вебхука (а Wazzup
    // ретраит) в карточке появлялись дубли. Если messageId не пришёл — пишем
    // без ключа: лучше возможный дубль, чем потерянное сообщение.
    //
    // ⚠️ ЛОВУШКА НА БУДУЩЕЕ: ЭТОТ КЛЮЧ НЕ СХОДИТСЯ С КЛЮЧОМ РАСШИРЕНИЯ.
    // Браузерное расширение-панель пишет в тот же channel="whatsapp" ключ вида
    // «<последние 10 цифр chatId>:<MsgKey.id из разметки>», а здесь получается
    // «<ВСЕ цифры chatId>:<GUID Wazzup>» — не совпадают ни чат, ни идентификатор
    // сообщения. Уникальный индекс (tenantId, channel, externalId) их не
    // склеит, и если у одного партнёра одновременно работают Wazzup и
    // расширение, каждое сообщение ляжет в карточку ДВАЖДЫ. Выровнять формат
    // ключа нельзя: у Wazzup свой GUID, у WhatsApp Web свой MsgKey, общего
    // идентификатора нет.
    //
    // Сейчас это теоретически: на 01.09.2026 в проде нет ни одной активной
    // интеграции Wazzup и ни одной whatsapp-коммуникации. Перед тем как
    // подключить Wazzup кому-то, у кого включено расширение (или наоборот), —
    // выбрать ОДИН канал записи для организации. См. docs/messenger-extension.md.
    const externalId = msg.messageId
      ? buildMessageExternalId(msg.chatId.replace(/\D/g, ""), msg.messageId)
      : null

    if (externalId) {
      const exists = await db.communication.findFirst({
        where: { tenantId, channel: "whatsapp", externalId },
        select: { id: true },
      })
      if (exists) {
        skipped++
        continue
      }
    }

    await db.communication.create({
      data: {
        tenantId,
        clientId: matches[0].id,
        type: msg.isFromMe ? "whatsapp_outgoing" : "whatsapp_incoming",
        channel: "whatsapp",
        direction: msg.isFromMe ? "outgoing" : "incoming",
        content: msg.text || null,
        externalId,
        // Время отправки в мессенджере, а не момент обработки вебхука — иначе
        // при задержке доставки сообщение встаёт в ленте не на своё место.
        sentAt: msg.timestamp ? new Date(msg.timestamp * 1000) : undefined,
        metadata: { messageType: msg.type, timestamp: msg.timestamp, chatId: msg.chatId },
      },
    })
    created++
  }

  return NextResponse.json({ ok: true, created, skipped })
}
