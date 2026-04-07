import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import bcrypt from "bcryptjs"

// POST /api/admin/seed — создать суперадмина + тариф (одноразовый endpoint)
export async function POST(req: NextRequest) {
  // Запрещаем в production (кроме dev-сервера с явным разрешением)
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DESTRUCTIVE_API !== "true") {
    return NextResponse.json({ error: "Seed недоступен в production" }, { status: 403 })
  }

  // Проверяем что суперадминов ещё нет — seed можно запустить только один раз
  const existingAdmin = await db.adminUser.findFirst({ where: { role: "superadmin" } })
  if (existingAdmin) {
    return NextResponse.json({ error: "Суперадмин уже существует" }, { status: 409 })
  }

  const hash = bcrypt.hashSync("admin123", 10)

  const admin = await db.adminUser.upsert({
    where: { email: "admin@umnayacrm.ru" },
    update: { passwordHash: hash },
    create: {
      email: "admin@umnayacrm.ru",
      passwordHash: hash,
      name: "Суперадмин",
      role: "superadmin",
    },
  })

  // Тарифный план
  const existingPlan = await db.billingPlan.findFirst()
  let plan = existingPlan
  if (!plan) {
    plan = await db.billingPlan.create({
      data: { name: "Стандарт", pricePerBranch: 5000, description: "5 000 ₽/мес за филиал" },
    })
  }

  // Подписки для всех организаций без подписки
  const orgs = await db.organization.findMany({
    where: { billingSubscriptions: { none: {} } },
  })
  const now = new Date()
  for (const org of orgs) {
    await db.billingSubscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        branchCount: 1,
        monthlyAmount: 5000,
        startDate: new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)),
        nextPaymentDate: new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1)),
      },
    })
  }

  return NextResponse.json({
    admin: admin.id,
    plan: plan.id,
    subscriptionsCreated: orgs.length,
  })
}
