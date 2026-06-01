import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

// GET /api/package-templates — активные шаблоны тенанта.
// Возвращает пустой массив для тенантов с subscriptionType != 'package'.
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = (session.user as { tenantId: string }).tenantId

  const templates = await db.packageTemplate.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { lessonsCount: "asc" }],
  })

  return NextResponse.json(templates)
}

const createSchema = z.object({
  lessonsCount: z.number().int().min(1).max(1000),
  validDays: z.number().int().min(1).max(3650).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
})

// POST /api/package-templates — создать шаблон.
// Доступно только owner/manager и только если org.subscriptionType === 'package'.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const tenantId = (session.user as { tenantId: string }).tenantId

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  if (org?.subscriptionType !== "package") {
    return NextResponse.json(
      { error: "Шаблоны пакетов доступны только при типе абонемента «Пакетный»" },
      { status: 409 },
    )
  }

  const body = await request.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const duplicate = await db.packageTemplate.findFirst({
    where: { tenantId, lessonsCount: parsed.data.lessonsCount, deletedAt: null },
  })
  if (duplicate) {
    return NextResponse.json(
      { error: `Шаблон на ${parsed.data.lessonsCount} занятий уже существует` },
      { status: 409 },
    )
  }

  const template = await db.packageTemplate.create({
    data: {
      tenantId,
      lessonsCount: parsed.data.lessonsCount,
      validDays: parsed.data.validDays ?? null,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
    },
  })

  return NextResponse.json(template, { status: 201 })
}
