import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const bulkSchema = z.object({
  templates: z
    .array(
      z.object({
        lessonsCount: z.number().int().min(1).max(1000),
        validDays: z.number().int().min(1).max(3650).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(50),
})

// POST /api/package-templates/bulk — массовая инициализация из wizard онбординга.
// Создаёт только отсутствующие шаблоны (по lessonsCount), не трогает существующие.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner") {
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
  const parsed = bulkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const existing = await db.packageTemplate.findMany({
    where: { tenantId, deletedAt: null },
    select: { lessonsCount: true },
  })
  const existingCounts = new Set(existing.map((t) => t.lessonsCount))

  const toCreate = parsed.data.templates.filter((t) => !existingCounts.has(t.lessonsCount))

  if (toCreate.length === 0) {
    return NextResponse.json({ created: 0, templates: [] })
  }

  await db.packageTemplate.createMany({
    data: toCreate.map((t, idx) => ({
      tenantId,
      lessonsCount: t.lessonsCount,
      validDays: t.validDays ?? null,
      sortOrder: t.sortOrder ?? idx,
      isActive: true,
    })),
  })

  const templates = await db.packageTemplate.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { lessonsCount: "asc" }],
  })

  return NextResponse.json({ created: toCreate.length, templates }, { status: 201 })
}
