import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import {
  reconcileDayToNonWorking,
  reconcileDayToWorking,
  findNonWorkingBlockers,
  nonWorkingBlockReason,
} from "@/lib/schedule/reconcile-calendar-day"

const updateSchema = z.object({
  isWorking: z.boolean().optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await db.productionCalendar.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })

  return NextResponse.json(item)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.productionCalendar.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })

  const tenantId = session.user.tenantId
  const createdBy = session.user.employeeId ?? null
  const wasNonWorking = existing.isWorking === false
  const nowNonWorking = (parsed.data.isWorking ?? existing.isWorking) === false

  // Гард на пометку «нерабочий» — до апдейта (см. findNonWorkingBlockers).
  if (!wasNonWorking && nowNonWorking) {
    const blockers = await findNonWorkingBlockers(db, { tenantId, date: existing.date })
    const reason = nonWorkingBlockReason(blockers)
    if (reason) {
      return NextResponse.json({ error: reason, lessons: blockers.details }, { status: 409 })
    }
  }

  const item = await db.productionCalendar.update({ where: { id }, data: parsed.data })

  // Смена «рабочести» дня → реконсиляция расписания/абонементов (после апдейта).
  let reconcile:
    | { deleted: number; subscriptionsUpdated: number }
    | { created: number; subscriptionsUpdated: number }
    | undefined
  if (!wasNonWorking && nowNonWorking) {
    reconcile = await reconcileDayToNonWorking(db, { tenantId, date: existing.date, createdBy })
  } else if (wasNonWorking && !nowNonWorking) {
    reconcile = await reconcileDayToWorking(db, { tenantId, date: existing.date, createdBy })
  }

  return NextResponse.json({ ...item, reconcile })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const existing = await db.productionCalendar.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })

  await db.productionCalendar.delete({ where: { id } })

  // Очистка записи возвращает день в рабочие. Если он был нерабочим — воссоздать
  // занятия дня и пересчитать абонементы (после удаления записи календаря).
  let reconcile: { created: number; subscriptionsUpdated: number } | undefined
  if (existing.isWorking === false) {
    reconcile = await reconcileDayToWorking(db, {
      tenantId: session.user.tenantId,
      date: existing.date,
      createdBy: session.user.employeeId ?? null,
    })
  }

  return NextResponse.json({ ok: true, reconcile })
}
