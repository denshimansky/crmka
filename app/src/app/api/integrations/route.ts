import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import crypto from "crypto"

const createSchema = z.object({
  provider: z.string().min(1, "Провайдер обязателен"),
  config: z.record(z.any()).default({}),
  isActive: z.boolean().default(true),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as any).tenantId

  const integrations = await db.integrationConfig.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(integrations)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = (session.user as any).role
  if (role !== "owner" && role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const tenantId = (session.user as any).tenantId
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  // Генерируем webhook secret
  const webhookSecret = crypto.randomBytes(32).toString("hex")

  const integration = await db.integrationConfig.create({
    data: {
      tenantId,
      provider: parsed.data.provider,
      config: parsed.data.config,
      isActive: parsed.data.isActive,
      webhookSecret,
    },
  })

  return NextResponse.json(integration, { status: 201 })
}
