import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions } from "@/lib/ext-cors"
import {
  MESSENGER_CHANNELS,
  buildMessageExternalId,
  messageTypeForDirection,
  normalizeChatId,
  toPrismaChannel,
} from "@/lib/ext/chat-identity"

/**
 * POST /api/ext/communications/batch — заливка увиденных сообщений в единую
 * историю коммуникаций (docs/messenger-extension.md).
 *
 * Смысл фичи: родитель писал в одном мессенджере, сегодня пишет в другом —
 * администратор видит всю переписку в карточке клиента.
 *
 * Идемпотентность обязательна: панель при КАЖДОМ открытии чата видит те же
 * последние сообщения и шлёт их повторно. Ключ — (tenantId, channel, externalId),
 * уникальный индекс в БД; createMany({ skipDuplicates }) молча пропускает
 * повторы, поэтому гонка двух вкладок не создаёт дублей.
 *
 * Пишем только то, что администратор и так видит на экране (принцип-щит из
 * спеки): никакой выкачки истории, никаких вложений — только текст, направление
 * и время.
 */
export const OPTIONS = extOptions

/** Ограничение длины текста: в БД поле text, но мегабайтные простыни нам не нужны. */
const MAX_TEXT_LENGTH = 4000

const messageSchema = z.object({
  /** Стабильный id сообщения В ПРЕДЕЛАХ чата (Telegram mid, WhatsApp MsgKey.id). */
  externalId: z.string().trim().min(1).max(200),
  direction: z.enum(["incoming", "outgoing"]),
  text: z.string().max(20000).nullish(),
  /** Время сообщения в мессенджере (ISO или unix-секунды). */
  sentAt: z.union([z.string(), z.number()]).nullish(),
})

const bodySchema = z.object({
  clientId: z.string().uuid(),
  channel: z.enum(MESSENGER_CHANNELS),
  chatId: z.string().min(1),
  messages: z.array(messageSchema).min(1).max(50),
})

function parseSentAt(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  // Unix-секунды (так отдаёт WhatsApp Store) или миллисекунды.
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.write")
  if (!guard.ok) return guard.response
  const { ctx } = guard

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return extJson(
      req,
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }
  const { clientId, channel, messages } = parsed.data

  const chatId = normalizeChatId(channel, parsed.data.chatId)
  if (!chatId) return extJson(req, { error: "Пустой идентификатор чата" }, { status: 400 })

  const client = await db.client.findFirst({
    where: {
      id: clientId,
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...scopeClientByBranch(ctx.branchScope),
    },
    select: { id: true },
  })
  if (!client) return extJson(req, { error: "Клиент не найден" }, { status: 404 })

  const rows = messages.map((m) => ({
    tenantId: ctx.tenantId,
    clientId,
    type: messageTypeForDirection(m.direction),
    channel: toPrismaChannel(channel),
    direction: m.direction,
    content: m.text?.slice(0, MAX_TEXT_LENGTH) ?? null,
    // id сообщения уникален лишь внутри чата — ключ склеиваем с чатом.
    externalId: buildMessageExternalId(chatId, m.externalId),
    sentAt: parseSentAt(m.sentAt),
    // Исходящие писал сотрудник, чьим токеном работает панель. У входящих автора
    // нет — сообщение написал клиент.
    employeeId: m.direction === "outgoing" ? ctx.employeeId : null,
    metadata: { source: "extension", chatId },
  }))

  const result = await db.communication.createMany({ data: rows, skipDuplicates: true })

  return extJson(req, {
    created: result.count,
    skipped: rows.length - result.count,
  })
}
