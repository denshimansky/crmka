import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { hasPermission, type RolePermissions } from "@/lib/permissions"
import { resolveBranchScope } from "@/lib/session"
import { scopeClientByBranch } from "@/lib/client-segments"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { phoneMatchKey } from "@/lib/phone"
import { findClientsByPhone } from "@/lib/clients/find-by-phone"

// Серверный поиск клиентов «по мере ввода» для комбобоксов (ClientCombobox в
// режиме serverSearch). Раньше страницы грузили ВСЮ базу клиентов в браузер
// (take:500/10000) и фильтровали на клиенте — при 3000–6000 клиентов это и
// раздувало payload, и обрезало хвост алфавита (клиент «Плаксина», ~2458-я по
// фамилии в базе из 3900, вообще не доходил до формы задачи). Теперь фильтрация
// на сервере: отдаём только совпадения (≤ limit).
//
// Параметры:
//   q         — строка поиска: токены по имени/фамилии (регистронезависимо,
//               порядок слов не важен) + опц. поиск по телефону.
//   limit     — сколько строк вернуть (1..MAX_LIMIT, дефолт DEFAULT_LIMIT).
//   status    — "all": без фильтра статуса (пикер задач — задачу можно ставить
//               и на архив/ЧС/лида); иначе (дефолт "payable") исключаем
//               архив и ЧС (оплаты, воронка — как notArchivedClient).
//   withPhone — включить телефон в ответ (для показа в выпадашке) и поиск по
//               номеру (оплаты/возвраты — идентификация тёзок по телефону).
//
// Всегда tenant-scope + branch-scope (ADM-04, scopeClientByBranch): скоуп-админ
// филиала через этот endpoint не должен доставать клиентов чужих филиалов.
// Право clients.view обязательно (инструктор клиентскую базу не видит).

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 30

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { role, tenantId } = session.user

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { rolePermissions: true },
  })
  const orgPerms = (org?.rolePermissions as RolePermissions | null) ?? null
  if (!hasPermission(role, "clients.view", orgPerms)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") ?? "").trim()
  const status = searchParams.get("status") === "all" ? "all" : "payable"
  const withPhone = searchParams.get("withPhone") === "1"
  const limitRaw = parseInt(searchParams.get("limit") ?? "", 10)
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT

  // Branch scope (как getBranchScope, но без redirect — тут API): для видимости
  // клиентов админ со ВСЕМИ филиалами = «видит всех» (coversAllBranches).
  const scope = await resolveBranchScope(tenantId, session.user.allowedBranchIds)

  const and: Prisma.ClientWhereInput[] = []
  const scopeWhere = scopeClientByBranch(scope)
  if (Object.keys(scopeWhere).length > 0) and.push(scopeWhere)

  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean)
    const searchOr: Prisma.ClientWhereInput[] = []
    // Совпадение по имени: каждый токен — в имени ИЛИ фамилии; между токенами
    // AND (порядок слов не важен: «Плаксина Ирина» = «Ирина Плаксина»).
    searchOr.push({
      AND: tokens.map((tok) => ({
        OR: [
          { firstName: { contains: tok, mode: "insensitive" as const } },
          { lastName: { contains: tok, mode: "insensitive" as const } },
        ],
      })),
    })
    // Совпадение по телефону (только при withPhone и достаточной длине): последние
    // N цифр номера — нормализация на стороне БД (findClientsByPhone). Приводим к
    // фильтру по id, чтобы branch/status-scope применились и к телефонным попаданиям.
    if (withPhone && phoneMatchKey(q)) {
      const byPhone = await findClientsByPhone(db, tenantId, q, { limit: MAX_LIMIT })
      const ids = byPhone.map((c) => c.id)
      if (ids.length > 0) searchOr.push({ id: { in: ids } })
    }
    and.push({ OR: searchOr })
  }

  const where: Prisma.ClientWhereInput = {
    tenantId,
    deletedAt: null,
    ...(and.length > 0 ? { AND: and } : {}),
  }
  // Дефолт "payable": прячем архив/ЧС (как notArchivedClient). "all" — без фильтра
  // (пикер задач). Присваиваем полем (не spread), чтобы TS вывел FunnelStatus[].
  if (status !== "all") {
    where.funnelStatus = { notIn: ["archived", "blacklisted"] }
  }

  const clients = await db.client.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, phone: true },
    orderBy: { lastName: "asc" },
    take: limit,
  })

  const instructorsSeePhones = session.user.instructorsSeePhones
  const results = clients.map((c) => ({
    id: c.id,
    name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени",
    ...(withPhone
      ? { phone: maskPhone(c.phone, role, instructorsSeePhones) ?? undefined }
      : {}),
  }))

  return NextResponse.json({ clients: results })
}
