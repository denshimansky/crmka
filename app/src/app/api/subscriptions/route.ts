import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { rateLimitTenant } from "@/lib/rate-limit"
import { applyDiscountToNewSubscription } from "@/lib/discounts/apply-to-new-subscription"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { branchScopeFromSession, scopeSubscription } from "@/lib/branch-scope"
import { z } from "zod"
import { Prisma } from "@prisma/client"

const createSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  directionId: z.string().uuid("Некорректный ID направления"),
  groupId: z.string().uuid("Некорректный ID группы"),
  periodYear: z.number().int().min(2020, "Некорректный год").max(2100).optional(),
  periodMonth: z.number().int().min(1, "Месяц от 1 до 12").max(12, "Месяц от 1 до 12").optional(),
  lessonPrice: z.number().min(0, "Цена не может быть отрицательной"),
  totalLessons: z.number().int().min(1, "Минимум 1 занятие"),
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  startDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  discountAmount: z.number().min(0).default(0),
  // Поля только для пакетного типа
  packageTemplateId: z.string().uuid().optional(),
  validDays: z.number().int().min(1).max(3650).optional(),
})

function addDaysUtc(d: Date, days: number): Date {
  const r = new Date(d.getTime())
  r.setUTCDate(r.getUTCDate() + days)
  return r
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const clientId = searchParams.get("clientId")
  const status = searchParams.get("status")
  const periodYear = searchParams.get("periodYear")
  const periodMonth = searchParams.get("periodMonth")

  const where: Prisma.SubscriptionWhereInput = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  }

  if (clientId) where.clientId = clientId
  if (status) where.status = status as any
  if (periodYear) where.periodYear = parseInt(periodYear)
  if (periodMonth) where.periodMonth = parseInt(periodMonth)

  // ADM-04: серверный scope по филиалу группы абонемента.
  const allowedBranchIds = (session.user as any).allowedBranchIds as string[] | null | undefined
  const scope = branchScopeFromSession(allowedBranchIds)
  const scopeFilter = scopeSubscription(scope)
  const finalWhere: Prisma.SubscriptionWhereInput =
    Object.keys(scopeFilter).length > 0 ? { AND: [where, scopeFilter] } : where

  const subscriptions = await db.subscription.findMany({
    where: finalWhere,
    include: {
      client: { select: { id: true, firstName: true, lastName: true, phone: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
      direction: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      payments: { select: { id: true, amount: true, date: true, method: true }, where: { deletedAt: null } },
    },
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { createdAt: "desc" }],
    take: 200,
  })

  // Возвраты на баланс при закрытии (subscription_closed_refund, amount > 0):
  // вычитаются из «Оплачено» в UI, чтобы закрытый с возвратом абонемент
  // не выглядел оплаченным (отрицательные суммы — перенос долга, не возврат).
  const subIds = subscriptions.map((s) => s.id)
  const refunds = subIds.length
    ? await db.clientBalanceTransaction.groupBy({
        by: ["subscriptionId"],
        where: {
          tenantId: session.user.tenantId,
          subscriptionId: { in: subIds },
          type: "subscription_closed_refund",
          amount: { gt: 0 },
        },
        _sum: { amount: true },
      })
    : []
  const refundBySub = new Map(refunds.map((r) => [r.subscriptionId, Number(r._sum.amount ?? 0)]))

  // Маскирование телефонов для инструктора.
  const masked = subscriptions.map((s) => ({
    ...s,
    client: { ...s.client, phone: maskPhone(s.client.phone, session.user.role) },
    refundedToBalance: refundBySub.get(s.id) ?? 0,
  }))

  return NextResponse.json(masked)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Tenant rate limiting (L-1 audit fix)
  const rl = rateLimitTenant(session.user.tenantId)
  if (!rl.ok) return NextResponse.json({ error: "Слишком много запросов" }, { status: 429 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверяем что клиент принадлежит тенанту
  const client = await db.client.findFirst({
    where: { id: data.clientId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  // Проверяем группу
  const group = await db.group.findFirst({
    where: { id: data.groupId, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!group) return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })

  // Достаём настройки организации для развилки по типу абонемента
  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    select: {
      subscriptionType: true,
      subscriptionTypeLockedAt: true,
      packageDefaultValidDays: true,
    },
  })
  const orgType = org?.subscriptionType ?? "calendar"

  // Для package — нужны srok годности и необязательно шаблон.
  // Для calendar — нужны periodYear/periodMonth.
  let resolvedValidDays: number | null = null
  let packageTemplateId: string | null = null
  if (orgType === "package") {
    if (data.packageTemplateId) {
      const tpl = await db.packageTemplate.findFirst({
        where: { id: data.packageTemplateId, tenantId: session.user.tenantId, deletedAt: null },
      })
      if (!tpl) return NextResponse.json({ error: "Шаблон пакета не найден" }, { status: 404 })
      packageTemplateId = tpl.id
      resolvedValidDays = data.validDays ?? tpl.validDays ?? org!.packageDefaultValidDays
    } else {
      resolvedValidDays = data.validDays ?? org!.packageDefaultValidDays
    }
  } else {
    // calendar / fixed — нужны period поля
    if (data.periodYear === undefined || data.periodMonth === undefined) {
      return NextResponse.json(
        { error: "Для календарного типа нужны periodYear и periodMonth" },
        { status: 400 },
      )
    }
  }

  // Запрет дублей абонементов (баг #52): у одного подопечного не должно быть
  // двух «живых» (pending/active) абонементов на одну и ту же группу в один и
  // тот же период (год+месяц). closed/withdrawn — нормально, это история.
  // Для package период не задан — проверку пропускаем.
  if (orgType !== "package" && data.periodYear !== undefined && data.periodMonth !== undefined) {
    const duplicateSub = await db.subscription.findFirst({
      where: {
        tenantId: session.user.tenantId,
        groupId: data.groupId,
        periodYear: data.periodYear,
        periodMonth: data.periodMonth,
        status: { in: ["pending", "active"] },
        deletedAt: null,
        // wardId сравниваем строго: null совпадает с null, uuid с uuid.
        wardId: data.wardId ?? null,
        // На взрослые абонементы (без подопечного) дублирование тоже не нужно —
        // привязка идёт к клиенту в этом случае.
        ...(data.wardId ? {} : { clientId: data.clientId }),
      },
      select: { id: true },
    })
    if (duplicateSub) {
      return NextResponse.json(
        { error: "У подопечного уже есть абонемент в эту группу на выбранный период." },
        { status: 409 },
      )
    }
  }

  const totalAmount = data.lessonPrice * data.totalLessons
  const finalAmount = totalAmount - data.discountAmount
  const balance = finalAmount // Сколько ещё нужно оплатить

  // Дата начала: startDate, либо для calendar — 1-е число месяца, либо сегодня (package).
  const startDate = data.startDate
    ? new Date(data.startDate)
    : orgType === "package"
      ? new Date()
      : new Date(data.periodYear!, data.periodMonth! - 1, 1)

  const expiresAt =
    orgType === "package" && resolvedValidDays !== null
      ? addDaysUtc(startDate, resolvedValidDays)
      : null

  const subscription = await db.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
      data: {
        tenantId: session.user.tenantId,
        clientId: data.clientId,
        wardId: data.wardId,
        directionId: data.directionId,
        groupId: data.groupId,
        type: orgType === "package" ? "package" : "calendar",
        status: "pending",
        periodYear: orgType === "package" ? null : data.periodYear!,
        periodMonth: orgType === "package" ? null : data.periodMonth!,
        lessonPrice: data.lessonPrice,
        totalLessons: data.totalLessons,
        totalAmount,
        discountAmount: data.discountAmount,
        finalAmount,
        balance,
        startDate,
        expiresAt,
        packageTemplateId,
        createdBy: session.user.employeeId,
      },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        direction: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        ward: { select: { id: true, firstName: true, lastName: true } },
      },
    })

    // ADM-04: денормализуем филиал последнего абонемента + считаем общее
    // количество купленных абонементов (нужно для сегмента «Нет/N абонементов»).
    // clientBalance НЕ трогаем — это реальные деньги клиента; долг живёт
    // только на стороне Subscription.balance до момента «Оплатить с баланса».
    await tx.client.update({
      where: { id: data.clientId },
      data: {
        lastBranchId: group.branchId,
        totalSubscriptionsCount: { increment: 1 },
      },
    })

    // Автоблокировка типа абонемента после создания первого
    if (!org!.subscriptionTypeLockedAt) {
      await tx.organization.update({
        where: { id: session.user.tenantId },
        data: {
          subscriptionType: orgType as "calendar" | "fixed" | "package",
          subscriptionTypeLockedAt: new Date(),
        },
      })
    }

    // Применяем шаблон скидки клиента ТОЛЬКО к новому абонементу.
    // Старые абонементы клиента не пересчитываем — шаблонные скидки
    // применяются к выпискам ПОСЛЕ установки шаблона.
    await applyDiscountToNewSubscription(tx, {
      tenantId: session.user.tenantId,
      clientId: data.clientId,
      subscriptionId: sub.id,
      createdBy: session.user.employeeId ?? null,
    })

    return sub
  })

  return NextResponse.json(subscription, { status: 201 })
}
