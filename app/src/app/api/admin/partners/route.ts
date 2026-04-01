import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
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
        },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(partners)
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

  const org = await db.organization.create({
    data: {
      name: d.name,
      legalName: d.legalName,
      inn: d.inn,
      phone: d.phone,
      email: d.email,
      contactPerson: d.contactPerson,
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

  // Автоматически создаём подписку на тариф «Стандарт» если есть
  const defaultPlan = await db.billingPlan.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } })
  if (defaultPlan) {
    const now = new Date()
    await db.billingSubscription.create({
      data: {
        organizationId: org.id,
        planId: defaultPlan.id,
        branchCount: 1,
        monthlyAmount: Number(defaultPlan.pricePerBranch),
        startDate: new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)),
        nextPaymentDate: new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)),
      },
    })
  }

  return NextResponse.json({ ...org, owner: owner ? { id: owner.id, login: owner.login } : null }, { status: 201 })
}
