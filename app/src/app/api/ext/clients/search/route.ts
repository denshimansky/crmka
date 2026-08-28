import { NextRequest } from "next/server"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { clientStateLabel } from "@/lib/clients/state-label"
import { findClientsByPhone } from "@/lib/clients/find-by-phone"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { requireExtAuth } from "@/lib/ext-auth"
import { extJson, extOptions } from "@/lib/ext-cors"

/**
 * GET /api/ext/clients/search?q=<имя или телефон>
 *
 * Нужен для ручной привязки чата: автоматически клиент нашёлся не всегда
 * (в Telegram телефона нет вовсе), и сотрудник ищет его сам.
 *
 * Отдельный роут, а не переиспользование /api/clients/search: тот работает под
 * cookie-сессией и отдаёт по умолчанию только «платёжеспособных» — а в чат
 * пишут и архивные родители, и лиды, которых как раз надо найти.
 */
export const OPTIONS = extOptions

const LIMIT = 8

export async function GET(req: NextRequest) {
  const guard = await requireExtAuth(req, "ext.read")
  if (!guard.ok) return guard.response
  const { ctx } = guard

  const q = new URL(req.url).searchParams.get("q")?.trim()
  if (!q || q.length < 2) return extJson(req, { clients: [] })

  const scope = scopeClientByBranch(ctx.branchScope)
  const select = {
    id: true,
    firstName: true,
    lastName: true,
    patronymic: true,
    phone: true,
    funnelStatus: true,
    clientStatus: true,
  }

  // Цифры во вводе — ищем как телефон (нормализация на стороне БД), иначе по ФИО.
  const digits = q.replace(/\D/g, "")
  const byPhone =
    digits.length >= 7 ? await findClientsByPhone(db, ctx.tenantId, q, { limit: LIMIT }) : []

  const byName = await db.client.findMany({
    where: {
      tenantId: ctx.tenantId,
      deletedAt: null,
      ...scope,
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { patronymic: { contains: q, mode: "insensitive" } },
      ],
    },
    select,
    take: LIMIT,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  })

  // findClientsByPhone филиальный scope не применяет — досеиваем сами, иначе
  // через поиск утёк бы клиент чужого филиала.
  const phoneIds = byPhone.map((c) => c.id)
  const phoneVisible = phoneIds.length
    ? await db.client.findMany({
        where: { id: { in: phoneIds }, tenantId: ctx.tenantId, deletedAt: null, ...scope },
        select,
      })
    : []

  const merged = [...phoneVisible, ...byName]
  const seen = new Set<string>()
  const clients = merged
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .slice(0, LIMIT)
    .map((c) => ({
      id: c.id,
      name:
        [c.lastName, c.firstName, c.patronymic].filter(Boolean).join(" ").trim() || "Без имени",
      phone: maskPhone(c.phone, ctx.role, ctx.instructorsSeePhones),
      stateLabel: clientStateLabel(c.funnelStatus, c.clientStatus),
    }))

  return extJson(req, { clients })
}
