import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { phoneMatchKey } from "@/lib/phone"

// GET /api/clients/duplicates — поиск дубликатов только по совпадающему телефону.
// (Совпадения по ФИО намеренно не ищем — слишком много ложных срабатываний.)
// Группируем по НОРМАЛИЗОВАННОМУ телефону (последние 10 цифр): «+7 (999) 12-34-56»
// и «89991234 56» — один номер. Раньше groupBy шёл по сырой строке phone и не
// видел по-разному отформатированные одинаковые номера.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  // id клиентов, чей нормализованный телефон встречается больше одного раза.
  // Нормализация (regexp_replace + last 10) на стороне БД — совпадает с
  // findClientsByPhone / запретом дублей.
  const dupIds = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM clients
    WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND phone IS NOT NULL
      AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 7
      AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) IN (
        SELECT right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
        FROM clients
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND phone IS NOT NULL
          AND length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 7
        GROUP BY 1
        HAVING count(*) > 1
      )
  `

  if (dupIds.length === 0) {
    return NextResponse.json([])
  }

  const clients = await db.client.findMany({
    where: { tenantId, deletedAt: null, id: { in: dupIds.map((r) => r.id) } },
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

  // Группируем по нормализованному ключу телефона (та же нормализация, что в SQL).
  const byKey = new Map<string, typeof clients>()
  for (const c of clients) {
    const key = phoneMatchKey(c.phone)
    if (!key) continue
    const list = byKey.get(key) ?? []
    list.push(c)
    byKey.set(key, list)
  }

  const result = Array.from(byKey.entries())
    .filter(([, list]) => list.length > 1)
    .map(([, list]) => ({
      matchType: "phone" as const,
      // Показываем реальный (форматированный) телефон первого клиента группы.
      matchValue: list[0].phone ?? "",
      clients: list.map((c) => ({
        ...c,
        clientBalance: c.clientBalance.toString(),
        moneyLtv: c.moneyLtv.toString(),
      })),
    }))

  return NextResponse.json(result)
}
