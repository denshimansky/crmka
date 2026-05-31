import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/clients/duplicates — поиск дубликатов по телефону и по ФИО.
// Группа по телефону приоритетна; группа по ФИО дополнительно ловит дубли
// без телефона (например, после импорта CSV с одинаковыми ФИО) — именно
// этот случай показан в баге #41.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  const allClients = await db.client.findMany({
    where: { tenantId, deletedAt: null },
    include: {
      wards: { select: { id: true, firstName: true, lastName: true } },
      branch: { select: { id: true, name: true } },
      _count: {
        select: {
          subscriptions: true,
          payments: true,
          enrollments: true,
          attendances: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  type Client = (typeof allClients)[number]
  type Group = { matchType: "phone" | "name"; matchValue: string; clients: Client[] }

  const byPhone = new Map<string, Client[]>()
  const byName = new Map<string, Client[]>()

  function nameKey(c: Client): string | null {
    const ln = (c.lastName || "").trim().toLowerCase()
    const fn = (c.firstName || "").trim().toLowerCase()
    if (!ln && !fn) return null
    return `${ln}|${fn}`
  }

  for (const c of allClients) {
    if (c.phone) {
      const list = byPhone.get(c.phone) ?? []
      list.push(c)
      byPhone.set(c.phone, list)
    }
    const nk = nameKey(c)
    if (nk) {
      const list = byName.get(nk) ?? []
      list.push(c)
      byName.set(nk, list)
    }
  }

  const groups: Group[] = []
  const seenInPhoneGroup = new Set<string>()

  for (const [phone, list] of byPhone.entries()) {
    if (list.length < 2) continue
    groups.push({ matchType: "phone", matchValue: phone, clients: list })
    for (const c of list) seenInPhoneGroup.add(c.id)
  }

  for (const [, list] of byName.entries()) {
    // Исключаем клиентов, уже попавших в группу по телефону, чтобы один и тот же
    // дубль не показывался дважды.
    const remaining = list.filter((c) => !seenInPhoneGroup.has(c.id))
    if (remaining.length < 2) continue
    const sample = remaining[0]
    const label = [sample.lastName, sample.firstName].filter(Boolean).join(" ") || "Без имени"
    groups.push({ matchType: "name", matchValue: label, clients: remaining })
  }

  const result = groups.map((g) => ({
    matchType: g.matchType,
    matchValue: g.matchValue,
    clients: g.clients.map((c) => ({
      ...c,
      clientBalance: c.clientBalance.toString(),
      moneyLtv: c.moneyLtv.toString(),
    })),
  }))

  return NextResponse.json(result)
}
