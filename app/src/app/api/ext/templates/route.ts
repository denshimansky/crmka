import { NextRequest } from "next/server"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions } from "@/lib/ext-cors"
import { isMessengerChannel, toPrismaChannel } from "@/lib/ext/chat-identity"
import { buildTemplatesForChat } from "@/lib/ext/templates"

/**
 * GET /api/ext/templates?clientId=<uuid>&channel=telegram
 *
 * Шаблоны ответов организации с УЖЕ подставленными данными клиента: панель
 * только вставляет текст в поле ввода, никакой бизнес-логики в расширении.
 *
 * clientId не передан (чат ещё не привязан) — шаблоны отдаются как есть,
 * с видимыми плейсхолдерами: лучше показать заготовку, чем прятать раздел.
 */
export const OPTIONS = extOptions

export async function GET(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.read")
  if (!guard.ok) return guard.response

  const { searchParams } = new URL(req.url)
  const channel = searchParams.get("channel")

  const templates = await buildTemplatesForChat(guard.ctx, {
    clientId: searchParams.get("clientId"),
    channel: channel && isMessengerChannel(channel) ? toPrismaChannel(channel) : null,
  })

  return extJson(req, { templates })
}
