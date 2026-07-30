import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { dayNumUtc } from "@/lib/subscriptions/direction-price"

// Запланированные будущие изменения цены направления (баг #88).
// GET  /api/directions/[id]/prices  — список будущих (непромоутнутых) версий.
// POST /api/directions/[id]/prices  — запланировать новую версию цены с даты.

const priceSchema = z.object({
  // Дата вступления в силу (по Subscription.startDate). Строго в будущем.
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД"),
  lessonPrice: z.number().min(0),
  trialFree: z.boolean().default(false),
  trialPrice: z.number().min(0).nullable().optional(),
  singleVisitPrice: z.number().min(0).nullable().optional(),
  packagePrices: z
    .record(z.string(), z.coerce.number().min(0))
    .transform((m) => {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(m)) if (Number.isFinite(v) && v >= 0) out[k] = v
      return out
    })
    .nullable()
    .optional(),
})

/** "ГГГГ-ММ-ДД" → UTC-полночь того же дня (как хранит @db.Date). */
function parseUtcDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

async function assertOwnDirection(tenantId: string, id: string) {
  return db.direction.findFirst({ where: { id, tenantId, deletedAt: null }, select: { id: true } })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  const direction = await assertOwnDirection(session.user.tenantId, id)
  if (!direction) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })

  const versions = await db.directionPrice.findMany({
    where: { directionId: id, tenantId: session.user.tenantId, deletedAt: null, appliedAt: null },
    orderBy: { effectiveFrom: "asc" },
    select: {
      id: true,
      effectiveFrom: true,
      lessonPrice: true,
      trialPrice: true,
      trialFree: true,
      singleVisitPrice: true,
      packagePrices: true,
    },
  })
  return NextResponse.json(versions)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }
  const { id } = await params

  const direction = await assertOwnDirection(session.user.tenantId, id)
  if (!direction) return NextResponse.json({ error: "Направление не найдено" }, { status: 404 })

  const parsed = priceSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const effectiveFrom = parseUtcDay(data.effectiveFrom)
  const today = dayNumUtc(new Date())
  if (dayNumUtc(effectiveFrom) <= today) {
    return NextResponse.json(
      { error: "Дата новой цены должна быть в будущем. Чтобы изменить цену сейчас, отредактируйте направление." },
      { status: 400 },
    )
  }

  const created = await db.directionPrice.create({
    data: {
      tenantId: session.user.tenantId,
      directionId: id,
      effectiveFrom,
      lessonPrice: data.lessonPrice,
      trialFree: data.trialFree,
      trialPrice: data.trialFree ? null : data.trialPrice ?? null,
      singleVisitPrice: data.singleVisitPrice ?? null,
      packagePrices:
        data.packagePrices == null ? Prisma.JsonNull : (data.packagePrices as Prisma.InputJsonValue),
      createdBy: session.user.employeeId ?? null,
    },
    select: {
      id: true,
      effectiveFrom: true,
      lessonPrice: true,
      trialPrice: true,
      trialFree: true,
      singleVisitPrice: true,
      packagePrices: true,
    },
  })
  return NextResponse.json(created, { status: 201 })
}
