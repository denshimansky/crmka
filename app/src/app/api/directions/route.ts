import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { DIRECTION_ICON_NAMES } from "@/lib/direction-icons"

const createSchema = z.object({
  name: z.string().min(1),
  lessonPrice: z.number().min(0),
  lessonDuration: z.number().min(15).max(480).default(45),
  trialPrice: z.number().min(0).optional(),
  trialFree: z.boolean().default(false),
  singleVisitPrice: z.number().min(0).nullable().optional(),
  packagePrices: z.record(z.string(), z.coerce.number().min(0)).transform((m) => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(m)) {
      if (Number.isFinite(v) && v >= 0) out[k] = v
    }
    return out
  }).nullable().optional(),
  color: z.string().optional(),
  icon: z.string().optional().nullable().refine(
    v => v == null || DIRECTION_ICON_NAMES.includes(v),
    "Недопустимая иконка",
  ),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const directions = await db.direction.findMany({
    where: { tenantId: session.user.tenantId, deletedAt: null },
    orderBy: { sortOrder: "asc" },
    // Будущие (непромоутнутые) версии цены — форма выписки подставляет цену,
    // действующую на дату старта абонемента (баг #88).
    include: {
      priceVersions: {
        where: { deletedAt: null, appliedAt: null },
        orderBy: { effectiveFrom: "asc" },
        select: { effectiveFrom: true, lessonPrice: true, packagePrices: true },
      },
    },
  })

  return NextResponse.json(directions)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Запрет дубликатов по названию (без учёта регистра) среди активных
  // (не архивных) направлений организации.
  const dup = await db.direction.findFirst({
    where: {
      tenantId: session.user.tenantId,
      deletedAt: null,
      name: { equals: data.name, mode: "insensitive" },
    },
    select: { id: true },
  })
  if (dup) {
    return NextResponse.json({ error: "Направление с таким названием уже существует" }, { status: 409 })
  }

  const direction = await db.direction.create({
    data: {
      tenantId: session.user.tenantId,
      name: data.name,
      lessonPrice: data.lessonPrice,
      lessonDuration: data.lessonDuration,
      trialPrice: data.trialPrice,
      trialFree: data.trialFree,
      singleVisitPrice: data.singleVisitPrice ?? null,
      packagePrices: data.packagePrices ?? undefined,
      color: data.color,
      icon: data.icon ?? undefined,
    },
  })

  return NextResponse.json(direction, { status: 201 })
}
