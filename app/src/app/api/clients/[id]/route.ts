import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"
import { ensureContactDateTaskForClient } from "@/lib/tasks/contact-date-task"
import { z } from "zod"

// PATCH — частичное обновление: отсутствующее в теле поле должно остаться
// undefined, иначе spread-гарды ниже затрут значение в БД (см. фикс бага
// «при смене скидки пропадает телефон»).
const nullableString = z.any().transform(v =>
  v === undefined
    ? undefined
    : typeof v === "string" && v.trim()
      ? v.trim()
      : null,
)

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  patronymic: nullableString,
  phone: nullableString,
  phone2: nullableString,
  email: nullableString.pipe(z.string().email("Некорректный email").nullish()),
  socialLink: nullableString,
  funnelStatus: z.enum(["new", "trial_scheduled", "trial_attended", "awaiting_payment", "active_client", "potential", "non_target", "blacklisted", "archived"]).optional(),
  clientStatus: z.enum(["active", "churned", "archived"]).nullable().optional(),
  // Ручной сегмент (баг #26): null — «Авто» (сброс к авто-расчёту по настройкам).
  segmentOverride: z.enum(["new_client", "standard", "regular", "vip"]).nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  comment: nullableString,
  nextContactDate: nullableString,
  blacklistReason: z.string().optional(),
  promisedPaymentDate: nullableString,
  firstPaidLessonDate: nullableString,
  discountTemplateId: z.string().uuid().nullable().optional(),
  // Баг #50: «Без скидки вручную» — явный запрет автоматических скидок родителю.
  autoDiscountDisabled: z.boolean().optional(),
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

  // Баг #50: «Без скидки вручную» (autoDiscountDisabled) и шаблон скидки (тип 2)
  // взаимоисключающи. Включение запрета сбрасывает выбранный шаблон; выбор
  // шаблона снимает запрет. Оба поля в одном PATCH — ошибка ввода.
  if (data.autoDiscountDisabled === true && data.discountTemplateId) {
    return NextResponse.json(
      { error: "Нельзя одновременно выбрать шаблон скидки и запретить скидки" },
      { status: 400 },
    )
  }
  if (data.autoDiscountDisabled === true) data.discountTemplateId = null
  if (data.discountTemplateId) data.autoDiscountDisabled = false

  // Скидки v2: вручную выбирается только постоянный шаблон (тип 2).
  // Автоскидка «за второй абонемент» (тип 1) и легаси-шаблоны не выбираются.
  if (data.discountTemplateId !== undefined && data.discountTemplateId !== null) {
    const tpl = await db.discountTemplate.findFirst({
      where: { id: data.discountTemplateId, tenantId: session.user.tenantId },
      select: { kind: true, isActive: true, isLegacy: true },
    })
    if (!tpl) {
      return NextResponse.json({ error: "Шаблон скидки не найден" }, { status: 404 })
    }
    if (tpl.kind !== "permanent" || tpl.isLegacy) {
      return NextResponse.json(
        { error: "Вручную можно выбрать только постоянную скидку" },
        { status: 400 },
      )
    }
    if (!tpl.isActive) {
      return NextResponse.json(
        { error: "Шаблон скидки выключен — включите его в настройках" },
        { status: 400 },
      )
    }
  }

  // Если воронка переводится в archived/blacklisted — снимаем clientStatus,
  // чтобы устаревшая плашка («Выбывший» и т.п.) не висела на карточке.
  const movingToArchived =
    !!data.funnelStatus &&
    (data.funnelStatus === "archived" || data.funnelStatus === "blacklisted") &&
    data.clientStatus === undefined

  // Скидки v2: смена шаблона — триггер пересчёта. Установка типа 2 заменяет
  // выданные тип-1-скидки (оставшиеся занятия), старые без скидки не трогает;
  // снятие («Без скидки») снимает тип-2-скидки и возвращает инвариант типа 1.
  // Update и пересчёт — одна транзакция: при сбое пересчёта выбор шаблона
  // тоже откатывается (нет рассинхрона «шаблон сменён, скидки старые»).
  const client = await db.$transaction(async (tx) => {
    const updated = await tx.client.update({
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
        // Возврат из «Выбывших» (Баг #5) — дата выбытия больше не актуальна.
        ...(data.clientStatus === "active" &&
          existing.clientStatus === "churned" && { withdrawalDate: null }),
        ...(data.branchId !== undefined && { branchId: data.branchId }),
        ...(data.assignedTo !== undefined && { assignedTo: data.assignedTo }),
        ...(data.comment !== undefined && { comment: data.comment }),
        ...(data.nextContactDate !== undefined && { nextContactDate: data.nextContactDate ? new Date(data.nextContactDate) : null }),
        ...(data.blacklistReason && { blacklistReason: data.blacklistReason, blacklistedBy: session.user.employeeId }),
        ...(data.promisedPaymentDate !== undefined && { promisedPaymentDate: data.promisedPaymentDate ? new Date(data.promisedPaymentDate) : null }),
        ...(data.firstPaidLessonDate !== undefined && { firstPaidLessonDate: data.firstPaidLessonDate ? new Date(data.firstPaidLessonDate) : null }),
        ...(data.discountTemplateId !== undefined && { discountTemplateId: data.discountTemplateId }),
        ...(data.autoDiscountDisabled !== undefined && { autoDiscountDisabled: data.autoDiscountDisabled }),
        // segmentOverride: null допустим (сброс к «Авто»), поэтому проверяем
        // именно на undefined, а не на truthiness.
        ...(data.segmentOverride !== undefined && { segmentOverride: data.segmentOverride }),
      },
      include: { wards: true, branch: { select: { id: true, name: true } } },
    })

    if (data.discountTemplateId !== undefined || data.autoDiscountDisabled !== undefined) {
      await recalcClientDiscounts(tx, {
        tenantId: session.user.tenantId,
        clientId: id,
        createdBy: session.user.employeeId ?? null,
      })
    }
    return updated
  })

  // Баг #18: если выставили дату связи и она уже наступила — создаём автозадачу
  // «Позвонить» сразу, чтобы она появилась в виджете «Задачи на сегодня», не
  // дожидаясь крона. Идемпотентно (дубль с генерацией не создаётся), безопасно к
  // ошибкам — не роняет ответ PATCH.
  if (data.nextContactDate) {
    await ensureContactDateTaskForClient(session.user.tenantId, id)
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
