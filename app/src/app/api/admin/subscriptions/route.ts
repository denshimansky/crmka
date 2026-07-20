import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { monthlyPriceFor } from "@/lib/billing-price"
import {
  trialEndFromStart,
  anchorDayFromTrialEnd,
  toUtcDate,
} from "@/lib/billing/billing-schedule"
import { z } from "zod"

// GET /api/admin/subscriptions — все подписки
export async function GET() {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const subscriptions = await db.billingSubscription.findMany({
    include: {
      organization: { select: { id: true, name: true, billingStatus: true } },
      plan: { select: { id: true, name: true, pricePerBranch: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(subscriptions)
}

const createSchema = z.object({
  organizationId: z.string().uuid("Некорректный ID организации"),
  planId: z.string().uuid("Некорректный ID плана"),
  branchCount: z.number().int().min(1, "Минимум 1 филиал").default(1),
  startDate: z.string({ required_error: "Дата начала обязательна" }),
})

// POST /api/admin/subscriptions — создать подписку
export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.role !== "superadmin" && session.role !== "billing") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  // Проверяем что план существует
  const plan = await db.billingPlan.findUnique({ where: { id: parsed.data.planId } })
  if (!plan) {
    return NextResponse.json({ error: "Тарифный план не найден" }, { status: 404 })
  }

  // ИНН обязателен: без него нельзя выставлять счета/матчить оплату (Bug #65).
  const org = await db.organization.findUnique({
    where: { id: parsed.data.organizationId },
    select: { inn: true },
  })
  const innDigits = (org?.inn || "").replace(/\D/g, "")
  if (innDigits.length !== 10 && innDigits.length !== 12) {
    return NextResponse.json(
      { error: "У организации не заполнен корректный ИНН — сначала укажите ИНН партнёра" },
      { status: 400 }
    )
  }

  const monthlyAmount = monthlyPriceFor(plan, parsed.data.branchCount)
  // 14-дневный тест от даты старта (Bug #65): срок первой оплаты = конец теста,
  // далее — индивидуальный день-якорь.
  const startDate = toUtcDate(new Date(parsed.data.startDate))
  const trialEnd = trialEndFromStart(startDate)

  const subscription = await db.billingSubscription.create({
    data: {
      organizationId: parsed.data.organizationId,
      planId: parsed.data.planId,
      branchCount: parsed.data.branchCount,
      monthlyAmount,
      status: "trial",
      startDate,
      trialEndsAt: trialEnd,
      billingAnchorDay: anchorDayFromTrialEnd(trialEnd),
      nextPaymentDate: trialEnd,
    },
    include: {
      organization: { select: { name: true } },
      plan: { select: { name: true } },
    },
  })

  // Убедимся что организация активна
  await db.organization.update({
    where: { id: parsed.data.organizationId },
    data: { billingStatus: "active" },
  })

  return NextResponse.json(subscription, { status: 201 })
}
