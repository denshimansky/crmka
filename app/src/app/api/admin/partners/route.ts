import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import { monthlyPriceFor } from "@/lib/billing-price"
import {
  trialEndFromStart,
  anchorDayFromTrialEnd,
  toUtcDate,
} from "@/lib/billing/billing-schedule"
import { generateUniquePortalSlug } from "@/lib/portal-slug"
import { z } from "zod"
import bcrypt from "bcryptjs"

// GET /api/admin/partners — список партнёров
export async function GET() {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const partners = await db.organization.findMany({
    include: {
      branches: { where: { deletedAt: null }, select: { id: true, name: true } },
      employees: { where: { role: "owner", deletedAt: null }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      billingSubscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { plan: { select: { name: true } } },
      },
      _count: {
        select: {
          employees: { where: { deletedAt: null } },
          clients: { where: { deletedAt: null } },
          branches: { where: { deletedAt: null } },
          directions: { where: { deletedAt: null } },
          aiChatLogs: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  // У Subscription нет relation на Organization (только колонка tenantId) —
  // активные абонементы считаем отдельным groupBy и подмешиваем в ответ.
  const activeSubs = await db.subscription.groupBy({
    by: ["tenantId"],
    where: { status: "active", deletedAt: null },
    _count: { _all: true },
  })
  const activeSubsByTenant = new Map(activeSubs.map((s) => [s.tenantId, s._count._all]))

  return NextResponse.json(
    partners.map((p) => ({ ...p, activeSubscriptions: activeSubsByTenant.get(p.id) ?? 0 }))
  )
}

const createSchema = z.object({
  name: z.string({ required_error: "Название обязательно" }).min(1, "Название обязательно"),
  legalName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  inn: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  contactPerson: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  // Owner — создаётся автоматически вместе с организацией
  ownerLastName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  ownerFirstName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  ownerLogin: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  ownerPassword: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  ownerEmail: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

// POST /api/admin/partners — создать партнёра (+ опционально owner)
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

  const d = parsed.data

  // ИНН обязателен: без него невозможно выставлять счета и матчить оплату по
  // выписке (Bug #65 — тест не должен стартовать без реквизитов). 10 цифр (ЮЛ)
  // или 12 (ИП/физлицо).
  const innDigits = (d.inn || "").replace(/\D/g, "")
  if (innDigits.length !== 10 && innDigits.length !== 12) {
    return NextResponse.json(
      { error: "Укажите корректный ИНН партнёра (10 или 12 цифр) — без него невозможно выставлять счета" },
      { status: 400 }
    )
  }

  const org = await db.organization.create({
    data: {
      name: d.name,
      legalName: d.legalName,
      inn: innDigits,
      phone: d.phone,
      email: d.email,
      contactPerson: d.contactPerson,
      // Слаг ЛК родителя (/p/<slug>) — сразу при создании организации
      portalSlug: await generateUniquePortalSlug(d.name),
    },
  })

  let owner = null

  // Создаём owner если указаны данные
  if (d.ownerLogin && d.ownerPassword && d.ownerFirstName && d.ownerLastName) {
    // Проверяем уникальность логина глобально
    const existingLogin = await db.employee.findFirst({
      where: { tenantId: org.id, login: d.ownerLogin, deletedAt: null },
    })
    if (existingLogin) {
      return NextResponse.json({ error: "Логин владельца уже занят" }, { status: 409 })
    }

    owner = await db.employee.create({
      data: {
        tenantId: org.id,
        login: d.ownerLogin,
        passwordHash: bcrypt.hashSync(d.ownerPassword, 10),
        firstName: d.ownerFirstName,
        lastName: d.ownerLastName,
        email: d.ownerEmail,
        role: "owner",
      },
    })
  }

  // Автоматически создаём подписку на тариф «Стандарт» если есть.
  // Новый партнёр стартует с 14-дневного теста: старт = сегодня, срок первой
  // оплаты = конец теста, далее — индивидуальный день-якорь (Bug #65).
  const defaultPlan = await db.billingPlan.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } })
  if (defaultPlan) {
    const start = toUtcDate(new Date())
    const trialEnd = trialEndFromStart(start)
    await db.billingSubscription.create({
      data: {
        organizationId: org.id,
        planId: defaultPlan.id,
        branchCount: 1,
        monthlyAmount: monthlyPriceFor(defaultPlan, 1),
        status: "trial",
        startDate: start,
        trialEndsAt: trialEnd,
        billingAnchorDay: anchorDayFromTrialEnd(trialEnd),
        nextPaymentDate: trialEnd,
      },
    })
  }

  return NextResponse.json({ ...org, owner: owner ? { id: owner.id, login: owner.login } : null }, { status: 201 })
}
