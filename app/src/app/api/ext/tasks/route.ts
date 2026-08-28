import { NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions, readExtJson } from "@/lib/ext-cors"

/**
 * POST /api/ext/tasks — задача по клиенту прямо из чата.
 *
 * Смысл: договорились в переписке «перезвоню завтра» — задача ставится не
 * выходя из мессенджера, иначе её просто не создадут.
 *
 * Исполнитель — всегда сам сотрудник: панель узкая, выбор коллеги в ней
 * превратился бы в отдельный экран, а «поставить задачу другому» и так есть в
 * CRM. Филиал не проставляем — ровно как POST /api/tasks при ручном создании
 * (задача видна всем, кто видит клиента); расходиться с CRM в видимости задач
 * нельзя, иначе одна и та же задача из разных мест ведёт себя по-разному.
 */
export const OPTIONS = extOptions

const bodySchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().trim().min(1, "Опишите задачу").max(500),
  /** «YYYY-MM-DD». Не указан — на сегодня. */
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД")
    .optional(),
})

/** «YYYY-MM-DD» → полночь UTC: dueDate хранится как @db.Date, зона сдвинула бы день. */
function toDueDate(day: string | undefined): Date {
  const iso = day ?? new Date().toISOString().slice(0, 10)
  return new Date(`${iso}T00:00:00.000Z`)
}

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

  const task = await db.task.create({
    data: {
      tenantId: ctx.tenantId,
      title: parsed.data.title,
      type: "manual",
      status: "pending",
      dueDate: toDueDate(parsed.data.dueDate),
      assignedTo: ctx.employeeId,
      assignedBy: ctx.employeeId,
      clientId: client.id,
    },
    select: { id: true, title: true, dueDate: true },
  })

  return extJson(req, {
    id: task.id,
    title: task.title,
    dueDate: task.dueDate.toISOString().slice(0, 10),
  })
}
