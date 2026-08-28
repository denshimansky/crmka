import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { logClientNote } from "@/lib/communications/log-note"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions, readExtJson } from "@/lib/ext-cors"

/**
 * POST /api/ext/comments — комментарий в карточку клиента из чата.
 *
 * Пишем через `logClientNote` — единую точку ленты коммуникаций: заметка из
 * панели обязана выглядеть и вести себя ровно как заметка, оставленная в CRM
 * (тип note, канал internal, автор — сотрудник). Своя вставка в communication
 * здесь однажды разъехалась бы с лентой по типу или каналу.
 *
 * Не путать с заливкой переписки (`/communications/batch`): та пишет сообщения
 * мессенджера, а это — то, что сотрудник хочет запомнить сам.
 */
export const OPTIONS = extOptions

const bodySchema = z.object({
  clientId: z.string().uuid(),
  text: z.string().trim().min(1, "Пустой комментарий").max(4000),
})

export async function POST(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.write")
  if (!guard.ok) return guard.response
  const { ctx } = guard

  // Битое тело больше не даёт 500 без CORS-заголовков (см. readExtJson).
  const body = await readExtJson(req)
  if (body === undefined) {
    return extJson(req, { error: "Ожидался JSON в теле запроса" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return extJson(
      req,
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 },
    )
  }

  const client = await db.client.findFirst({
    where: {
      id: parsed.data.clientId,
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...scopeClientByBranch(ctx.branchScope),
    },
    select: { id: true },
  })
  if (!client) return extJson(req, { error: "Клиент не найден" }, { status: 404 })

  await logClientNote(db, {
    tenantId: ctx.tenantId,
    clientId: client.id,
    content: parsed.data.text,
    employeeId: ctx.employeeId,
  })

  return extJson(req, { ok: true })
}
