import { NextRequest } from "next/server"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions } from "@/lib/ext-cors"
import { buildQuickInfo } from "@/lib/ext/quick-info"

/**
 * GET /api/ext/quick-info?clientId=<uuid>
 *
 * «Вставить справку»: готовые куски текста для ответа родителю — расписание
 * ребёнка, остаток по абонементу, баланс. Панель вставляет выбранный текст в
 * поле ввода мессенджера; отправляет человек (принцип-щит, §3 спеки).
 *
 * Отдельный роут, а не поле в client-card: справка нужна по клику, а карточка
 * перечитывается сама раз в минуту — незачем гонять формирование текста и
 * лишние запросы к расписанию на каждое обновление.
 *
 * Клиент вне филиального доступа сотрудника — 404 (не подтверждаем существование).
 */
export const OPTIONS = extOptions

export async function GET(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.read")
  if (!guard.ok) return guard.response

  const clientId = new URL(req.url).searchParams.get("clientId")
  if (!clientId) return extJson(req, { error: "Не указан клиент" }, { status: 400 })

  const info = await buildQuickInfo(guard.ctx, clientId)
  if (!info) return extJson(req, { error: "Клиент не найден" }, { status: 404 })

  return extJson(req, info)
}
