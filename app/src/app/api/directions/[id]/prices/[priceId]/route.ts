import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { dayNumUtc } from "@/lib/subscriptions/direction-price"

// Правка/удаление запланированной версии цены направления (баг #88).
// PATCH  /api/directions/[id]/prices/[priceId]  — изменить непромоутнутую версию.
// DELETE /api/directions/[id]/prices/[priceId]  — отменить запланированную версию (soft).

const updateSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД").optional(),
  lessonPrice: z.number().min(0).optional(),
  trialFree: z.boolean().optional(),
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

function parseUtcDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Проверяет владение версией: она принадлежит направлению id тенанта, не удалена, не промоутнута. */
async function loadOwnVersion(tenantId: string, directionId: string, priceId: string) {
  return db.directionPrice.findFirst({
    where: { id: priceId, directionId, tenantId, deletedAt: null, appliedAt: null },
    select: { id: true },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; priceId: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }
  const { id, priceId } = await params

  const existing = await loadOwnVersion(session.user.tenantId, id, priceId)
  if (!existing) return NextResponse.json({ error: "Версия цены не найдена" }, { status: 404 })

  const parsed = updateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { effectiveFrom, packagePrices, ...rest } = parsed.data

  const data: Prisma.DirectionPriceUpdateInput = { ...rest }
  if (effectiveFrom !== undefined) {
    const eff = parseUtcDay(effectiveFrom)
    if (dayNumUtc(eff) <= dayNumUtc(new Date())) {
      return NextResponse.json(
        { error: "Дата новой цены должна быть в будущем." },
        { status: 400 },
      )
    }
    data.effectiveFrom = eff
  }
  if (packagePrices !== undefined) {
    data.packagePrices = packagePrices === null ? Prisma.JsonNull : packagePrices
  }
  // Синхронизируем trialPrice с флагом trialFree (как в форме направления).
  if (rest.trialFree === true) data.trialPrice = null

  const updated = await db.directionPrice.update({
    where: { id: priceId },
    data,
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
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; priceId: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }
  const { id, priceId } = await params

  const existing = await loadOwnVersion(session.user.tenantId, id, priceId)
  if (!existing) return NextResponse.json({ error: "Версия цены не найдена" }, { status: 404 })

  await db.directionPrice.update({ where: { id: priceId }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
