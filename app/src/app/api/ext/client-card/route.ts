import { NextRequest } from "next/server"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions } from "@/lib/ext-cors"
import { buildClientCard } from "@/lib/ext/client-card"

/**
 * GET /api/ext/client-card?clientId=<uuid>
 *
 * Карточка клиента для панели одним запросом: клиент, подопечные с возрастом и
 * прошедшим/ближайшим занятием, активные абонементы, платежи, баланс и последние
 * сообщения по всем каналам.
 *
 * Клиент вне филиального доступа сотрудника отдаётся как 404 (а не 403) —
 * не подтверждаем его существование.
 */
export const OPTIONS = extOptions

export async function GET(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.read")
  if (!guard.ok) return guard.response

  const clientId = new URL(req.url).searchParams.get("clientId")
  if (!clientId) return extJson(req, { error: "Не указан клиент" }, { status: 400 })

  const card = await buildClientCard(guard.ctx, clientId)
  if (!card) return extJson(req, { error: "Клиент не найден" }, { status: 404 })

  return extJson(req, card)
}
