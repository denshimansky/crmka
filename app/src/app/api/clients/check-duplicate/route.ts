import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { findClientsByPhone } from "@/lib/clients/find-by-phone"

// GET /api/clients/check-duplicate?phone=XXX — поиск существующих клиентов/лидов
// по телефону для живой подсказки в форме создания. Нормализация обеих сторон
// (формат и код 8/7) — общий хелпер findClientsByPhone, та же логика, что и в
// жёстком запрете дублей POST /api/clients.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const { searchParams } = new URL(req.url)
  const phone = searchParams.get("phone")?.trim()

  if (!phone) return NextResponse.json([])

  const matches = await findClientsByPhone(db, tenantId, phone, { limit: 5 })
  return NextResponse.json(matches)
}
