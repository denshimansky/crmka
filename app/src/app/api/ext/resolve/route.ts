import { NextRequest } from "next/server"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions } from "@/lib/ext-cors"
import { isMessengerChannel } from "@/lib/ext/chat-identity"
import { resolveClientForChat } from "@/lib/ext/resolve-client"

/**
 * GET /api/ext/resolve?channel=telegram&chatId=@masha[&phone=79991234567]
 *
 * «Кто открыт в чате?» — первый запрос панели при каждой смене диалога.
 * Ответ: однозначный клиент, список кандидатов для ручного выбора либо пусто
 * (тогда панель предложит привязать чат или создать лида).
 */
export const OPTIONS = extOptions

export async function GET(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.read")
  if (!guard.ok) return guard.response

  const { searchParams } = new URL(req.url)
  const channel = searchParams.get("channel")
  if (!channel || !isMessengerChannel(channel)) {
    return extJson(req, { error: "Неизвестный канал" }, { status: 400 })
  }

  const result = await resolveClientForChat(guard.ctx, {
    channel,
    chatId: searchParams.get("chatId"),
    phone: searchParams.get("phone"),
  })

  return extJson(req, result)
}
