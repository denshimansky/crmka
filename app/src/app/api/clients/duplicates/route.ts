import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/clients/duplicates — поиск дубликатов по телефону
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  // Найти телефоны, которые встречаются у нескольких клиентов
  const duplicatePhones = await db.client.groupBy({
    by: ["phone"],
    where: {
      tenantId,
      deletedAt: null,
      phone: { not: null },
    },
    _count: { id: true },
    having: {
      id: { _count: { gt: 1 } },
    },
  })

  if (duplicatePhones.length === 0) {
    return NextResponse.json([])
  }

  // Получить клиентов для каждого дублирующегося телефона
  const phones = duplicatePhones.map((d) => d.phone).filter(Boolean) as string[]

  const clients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      phone: { in: phones },
    },
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

  // Сгруппировать по телефону
  const groups: Record<string, typeof clients> = {}
  for (const client of clients) {
    const phone = client.phone!
    if (!groups[phone]) groups[phone] = []
    groups[phone].push(client)
  }

  const result = Object.entries(groups).map(([phone, clients]) => ({
    phone,
    clients: clients.map((c) => ({
      ...c,
      clientBalance: c.clientBalance.toString(),
      moneyLtv: c.moneyLtv.toString(),
    })),
  }))

  return NextResponse.json(result)
}
