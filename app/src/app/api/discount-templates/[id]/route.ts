import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  recalcAllClientsForType1,
  TYPE1_SYSTEM_KEY,
} from "@/lib/discounts/recalc-client-discounts"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().min(1, "Название обязательно").optional(),
  valueType: z.enum(["percent", "fixed"]).optional(),
  value: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await db.discountTemplate.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!item) return NextResponse.json({ error: "Шаблон скидки не найден" }, { status: 404 })

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

  const existing = await db.discountTemplate.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Шаблон скидки не найден" }, { status: 404 })

  // Скидки v2: легаси-шаблоны редактировать нельзя (история).
  if (existing.isLegacy) {
    return NextResponse.json(
      { error: "Шаблон старой логики скидок: редактирование недоступно" },
      { status: 400 },
    )
  }

  // Системные шаблоны (systemKey != null) защищаем от переименования:
  // меняются только valueType/value/isActive.
  const isSystem = existing.systemKey !== null
  const data: typeof parsed.data & { activatedAt?: Date } = { ...parsed.data }
  if (isSystem && parsed.data.name !== undefined && parsed.data.name !== existing.name) {
    return NextResponse.json(
      { error: "Системный шаблон нельзя переименовать" },
      { status: 400 },
    )
  }

  // Скидки v2: включение тоггла типа 1 фиксирует activatedAt — скидка
  // действует на абонементы с периодом со СЛЕДУЮЩЕГО месяца.
  const isType1 = existing.systemKey === TYPE1_SYSTEM_KEY
  const turningOn = isType1 && parsed.data.isActive === true && !existing.isActive
  if (turningOn) {
    data.activatedAt = new Date()
  }

  const item = await db.discountTemplate.update({ where: { id }, data })

  // Разовый пересчёт уже выписанных абонементов будущих месяцев (продлённые
  // заранее получают скидку сразу). Текущий месяц не трогается.
  if (turningOn) {
    const processed = await recalcAllClientsForType1(
      db,
      session.user.tenantId,
      session.user.employeeId ?? null,
    )
    return NextResponse.json({ ...item, _recalculatedClients: processed })
  }

  return NextResponse.json(item)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const existing = await db.discountTemplate.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Шаблон скидки не найден" }, { status: 404 })

  if (existing.systemKey !== null) {
    return NextResponse.json(
      { error: "Системный шаблон нельзя удалить, можно деактивировать через isActive=false" },
      { status: 400 },
    )
  }

  await db.discountTemplate.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
