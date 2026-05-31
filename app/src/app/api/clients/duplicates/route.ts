import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/clients/duplicates — поиск дубликатов только по совпадающему телефону.
// (Совпадения по ФИО намеренно не ищем — слишком много ложных срабатываний.)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  const duplicatePhones = await db.client.groupBy({
    by: ["phone"],
    where: {
      tenantId,
      deletedAt: null,
      phone: { not: null },
    },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  })

  if (duplicatePhones.length === 0) {
    return NextResponse.json([])
  }

  const phones = duplicatePhones.map((d) => d.phone).filter(Boolean) as string[]

  const clients = await db.client.findMany({
    where: { tenantId, deletedAt: null, phone: { in: phones } },
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

  const byPhone = new Map<string, typeof clients>()
  for (const c of clients) {
    if (!c.phone) continue
    const list = byPhone.get(c.phone) ?? []
    list.push(c)
    byPhone.set(c.phone, list)
  }

  const result = Array.from(byPhone.entries()).map(([phone, list]) => ({
    matchType: "phone" as const,
    matchValue: phone,
    clients: list.map((c) => ({
      ...c,
      clientBalance: c.clientBalance.toString(),
      moneyLtv: c.moneyLtv.toString(),
    })),
  }))

  return NextResponse.json(result)
}
