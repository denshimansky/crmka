import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/clients/check-duplicate?phone=XXX — поиск существующих клиентов/лидов по телефону
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const { searchParams } = new URL(req.url)
  const phone = searchParams.get("phone")?.trim()

  if (!phone || phone.length < 4) {
    return NextResponse.json([])
  }

  // Нормализуем: убираем всё кроме цифр для поиска
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 4) {
    return NextResponse.json([])
  }

  // Ищем по phone и phone2, совпадение по цифрам в конце (последние N цифр)
  const clients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      OR: [
        { phone: { contains: digits.slice(-7) } },
        { phone2: { contains: digits.slice(-7) } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      phone2: true,
      funnelStatus: true,
      clientStatus: true,
    },
    take: 5,
  })

  // Фильтруем точнее: проверяем что цифры телефона действительно совпадают
  const matches = clients.filter((c) => {
    const normalize = (p: string | null) => p?.replace(/\D/g, "") || ""
    const cDigits1 = normalize(c.phone)
    const cDigits2 = normalize(c.phone2)
    // Совпадение если последние 10 цифр одинаковы (или вся строка при коротких номерах)
    const matchLen = Math.min(digits.length, 10)
    return (
      (cDigits1.length >= matchLen && cDigits1.slice(-matchLen) === digits.slice(-matchLen)) ||
      (cDigits2.length >= matchLen && cDigits2.slice(-matchLen) === digits.slice(-matchLen))
    )
  })

  return NextResponse.json(matches)
}
