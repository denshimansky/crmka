import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { resolveBranchScope } from "@/lib/session"
import { wardVisibilityWhere, formatWardOptionLabel } from "@/lib/wards/ward-scope"

// Серверный поиск подопечных «по мере ввода» для фильтра «Ребёнок» в расписании.
// Раньше страница расписания грузила список детей целиком (take: 1000) и
// фильтровала его на клиенте — при базе крупнее тысячи детей это обрезало хвост
// алфавита: ребёнок «Каргин Артём» не находился, хотя стоял на занятии. Та же
// болезнь, что уже лечили для клиентов (см. /api/clients/search).
//
// Параметры:
//   q     — строка поиска: токены по ФИО ребёнка И/ИЛИ ФИО родителя
//           (регистронезависимо, порядок слов не важен: «артём каргин» = «каргин артём»).
//   limit — сколько строк вернуть (1..MAX_LIMIT, дефолт DEFAULT_LIMIT).
//
// Видимость (ADM-04) — общая со страницей расписания через wardVisibilityWhere:
// инструктор видит только детей своих групп и свои пробные, скоуп-админ — только
// детей своих филиалов.
//
// Ответ отдаём под ключом `clients` — так его без правок читает ClientCombobox
// в режиме serverSearch (см. components/client-combobox.tsx).

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 30

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { role, tenantId, employeeId } = session.user

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") ?? "").trim()
  const limitRaw = parseInt(searchParams.get("limit") ?? "", 10)
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT

  const scope = await resolveBranchScope(tenantId, session.user.allowedBranchIds)
  const visibility = wardVisibilityWhere(role, employeeId, scope)

  const and: Prisma.WardWhereInput[] = []
  if (visibility) and.push(visibility)

  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean)
    // Каждый токен должен найтись в имени/фамилии ребёнка ИЛИ родителя;
    // между токенами AND — порядок слов не важен.
    and.push({
      AND: tokens.map((tok) => ({
        OR: [
          { firstName: { contains: tok, mode: "insensitive" as const } },
          { lastName: { contains: tok, mode: "insensitive" as const } },
          { client: { firstName: { contains: tok, mode: "insensitive" as const } } },
          { client: { lastName: { contains: tok, mode: "insensitive" as const } } },
        ],
      })),
    })
  }

  const wards = await db.ward.findMany({
    where: {
      tenantId,
      client: { deletedAt: null },
      ...(and.length > 0 ? { AND: and } : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      client: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: limit,
  })

  return NextResponse.json({
    clients: wards.map((w) => ({ id: w.id, name: formatWardOptionLabel(w) })),
  })
}
