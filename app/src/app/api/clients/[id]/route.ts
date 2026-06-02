import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { recalculateDiscountsForClient } from "@/lib/discounts/recalculate-for-client"
import { z } from "zod"

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  patronymic: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  phone2: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).pipe(z.string().email("Некорректный email").nullable()),
  socialLink: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  funnelStatus: z.enum(["new", "trial_scheduled", "trial_attended", "awaiting_payment", "active_client", "potential", "non_target", "blacklisted", "archived"]).optional(),
  clientStatus: z.enum(["active", "upsell", "churned", "returning", "archived"]).nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  nextContactDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  blacklistReason: z.string().optional(),
  promisedPaymentDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  firstPaidLessonDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  // Включённый родителем шаблон скидки (или null — выключить).
  discountTemplateId: z.string().uuid().nullable().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const client = await db.client.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
    include: {
      wards: true,
      branch: { select: { id: true, name: true } },
      assignee: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  // Маскирование телефонов для роли «инструктор» — жёсткая политика.
  return NextResponse.json({
    ...client,
    phone: maskPhone(client.phone, session.user.role),
    phone2: maskPhone(client.phone2, session.user.role),
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const existing = await db.client.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  // Нельзя вернуть клиента в лида
  if (existing.clientStatus === "active" && data.funnelStatus && data.funnelStatus !== "active_client") {
    return NextResponse.json({ error: "Нельзя вернуть активного клиента в воронку лидов" }, { status: 400 })
  }

  // Возврат из Архив/ЧС — только владелец
  if (
    data.funnelStatus &&
    data.funnelStatus !== existing.funnelStatus &&
    (existing.funnelStatus === "archived" || existing.funnelStatus === "blacklisted") &&
    session.user.role !== "owner"
  ) {
    return NextResponse.json(
      { error: "Только владелец может вернуть клиента из архива или чёрного списка" },
      { status: 403 },
    )
  }

  // Перевод в «Выбывшие» (clientStatus=churned) — только если у клиента
  // не осталось активных абонементов ни у одного из подопечных.
  if (data.clientStatus === "churned" && existing.clientStatus !== "churned") {
    const activeSubs = await db.subscription.count({
      where: {
        tenantId: session.user.tenantId,
        clientId: id,
        status: "active",
        deletedAt: null,
      },
    })
    if (activeSubs > 0) {
      return NextResponse.json(
        {
          error:
            `Нельзя перевести в «Выбывшие»: у клиента есть ${activeSubs} активный абонемент(ов). ` +
            "Сначала закройте или отчислите их.",
          activeSubscriptions: activeSubs,
        },
        { status: 422 },
      )
    }
  }

  // Если воронка переводится в archived/blacklisted — снимаем clientStatus,
  // чтобы устаревшая плашка («Выбывший» и т.п.) не висела на карточке.
  const movingToArchived =
    !!data.funnelStatus &&
    (data.funnelStatus === "archived" || data.funnelStatus === "blacklisted") &&
    data.clientStatus === undefined

  const client = await db.client.update({
    where: { id },
    data: {
      ...(data.firstName !== undefined && { firstName: data.firstName }),
      ...(data.lastName !== undefined && { lastName: data.lastName }),
      ...(data.patronymic !== undefined && { patronymic: data.patronymic }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.phone2 !== undefined && { phone2: data.phone2 }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.socialLink !== undefined && { socialLink: data.socialLink }),
      ...(data.funnelStatus && { funnelStatus: data.funnelStatus }),
      ...(movingToArchived
        ? { clientStatus: null }
        : data.clientStatus !== undefined && { clientStatus: data.clientStatus }),
      ...(data.branchId !== undefined && { branchId: data.branchId }),
      ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo }),
      ...(data.comment !== undefined && { comment: data.comment }),
      ...(data.nextContactDate !== undefined && { nextContactDate: data.nextContactDate ? new Date(data.nextContactDate) : null }),
      ...(data.blacklistReason && { blacklistReason: data.blacklistReason, blacklistedBy: session.user.employeeId }),
      ...(data.promisedPaymentDate !== undefined && { promisedPaymentDate: data.promisedPaymentDate ? new Date(data.promisedPaymentDate) : null }),
      ...(data.firstPaidLessonDate !== undefined && { firstPaidLessonDate: data.firstPaidLessonDate ? new Date(data.firstPaidLessonDate) : null }),
      ...(data.discountTemplateId !== undefined && { discountTemplateId: data.discountTemplateId }),
    },
    include: { wards: true, branch: { select: { id: true, name: true } } },
  })

  // Смена шаблона скидки → пересчитать pending/active абонементы.
  if (
    data.discountTemplateId !== undefined &&
    data.discountTemplateId !== existing.discountTemplateId
  ) {
    await db.$transaction(async (tx) => {
      await recalculateDiscountsForClient(tx, {
        tenantId: session.user.tenantId,
        clientId: id,
        createdBy: session.user.employeeId ?? null,
      })
    })
  }

  return NextResponse.json(client)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params

  const existing = await db.client.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  await db.client.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
