import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { generatePortalToken } from "@/lib/portal-auth"

// POST /api/clients/[id]/portal-link — сгенерировать ссылку на ЛК клиента
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const client = await db.client.findFirst({
    where: { id, tenantId, deletedAt: null },
  })
  if (!client) {
    return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  }

  // Деактивируем старые токены
  await db.clientPortalToken.updateMany({
    where: { clientId: id, tenantId, isActive: true },
    data: { isActive: false },
  })

  // Создаём новый
  const token = generatePortalToken()
  await db.clientPortalToken.create({
    data: {
      tenantId,
      clientId: id,
      token,
    },
  })

  const baseUrl = process.env.NEXTAUTH_URL || "https://dev.umnayacrm.ru"
  const link = `${baseUrl}/portal?token=${token}`

  return NextResponse.json({ link, token })
}

// GET /api/clients/[id]/portal-link — получить текущую ссылку
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const portalToken = await db.clientPortalToken.findFirst({
    where: { clientId: id, tenantId, isActive: true },
    orderBy: { createdAt: "desc" },
  })

  if (!portalToken) {
    return NextResponse.json({ link: null })
  }

  const baseUrl = process.env.NEXTAUTH_URL || "https://dev.umnayacrm.ru"
  return NextResponse.json({
    link: `${baseUrl}/portal?token=${portalToken.token}`,
    token: portalToken.token,
    createdAt: portalToken.createdAt,
  })
}
