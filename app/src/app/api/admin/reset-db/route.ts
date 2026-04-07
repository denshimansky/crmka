import { NextRequest, NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { db } from "@/lib/db"
import bcrypt from "bcryptjs"

// POST /api/admin/reset-db — полный сброс БД + seed
// Только для superadmin, только dev-среда
export async function POST(req: NextRequest) {
  // Запрещаем в production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Reset-db недоступен в production" }, { status: 403 })
  }

  const session = await getAdminSession()
  if (!session || session.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Удаляем всё в правильном порядке (FK constraints)
  await db.$transaction([
    db.attendance.deleteMany(),
    db.callCampaignItem.deleteMany(),
    db.callCampaign.deleteMany(),
    db.task.deleteMany(),
    db.discount.deleteMany(),
    db.payment.deleteMany(),
    db.subscription.deleteMany(),
    db.groupEnrollment.deleteMany(),
    db.lesson.deleteMany(),
    db.groupScheduleTemplate.deleteMany(),
    db.salaryAdjustment.deleteMany(),
    db.salaryPayment.deleteMany(),
    db.salaryRate.deleteMany(),
    db.accountOperation.deleteMany(),
    db.expenseBranch.deleteMany(),
    db.expense.deleteMany(),
    db.expenseCategory.deleteMany(),
    db.attendanceType.deleteMany(),
    db.ward.deleteMany(),
    db.clientPortalToken.deleteMany(),
    db.client.deleteMany(),
    db.group.deleteMany(),
    db.direction.deleteMany(),
    db.financialAccount.deleteMany(),
    db.room.deleteMany(),
    db.employeeBranch.deleteMany(),
    db.auditLog.deleteMany(),
    db.billingInvoice.deleteMany(),
    db.billingSubscription.deleteMany(),
    db.billingPlan.deleteMany(),
    db.user.deleteMany(),
    db.employee.deleteMany(),
    db.branch.deleteMany(),
    db.organization.deleteMany(),
    db.adminUser.deleteMany(),
  ])

  // Seed: суперадмин + тариф
  const hash = (pwd: string) => bcrypt.hashSync(pwd, 10)

  await db.adminUser.create({
    data: {
      email: "admin@umnayacrm.ru",
      passwordHash: hash("admin123"),
      name: "Суперадмин",
      role: "superadmin",
    },
  })

  const plan = await db.billingPlan.create({
    data: {
      name: "Стандарт",
      pricePerBranch: 5000,
      description: "5 000 ₽/мес за филиал",
    },
  })

  // Seed attendance types
  const attendanceTypes = [
    { name: "Явка", code: "present", chargesSubscription: true, paysInstructor: true, countsAsRevenue: true, isSystem: true, sortOrder: 1 },
    { name: "Прогул", code: "absent", chargesSubscription: true, paysInstructor: false, countsAsRevenue: false, isSystem: true, sortOrder: 2 },
    { name: "Перерасчёт", code: "recalc", chargesSubscription: false, paysInstructor: false, countsAsRevenue: false, isSystem: true, sortOrder: 3 },
    { name: "Отработка", code: "makeup", chargesSubscription: true, paysInstructor: true, countsAsRevenue: true, isSystem: true, sortOrder: 4 },
    { name: "Пробное", code: "trial", chargesSubscription: false, paysInstructor: true, countsAsRevenue: false, isSystem: true, sortOrder: 5 },
  ]

  await db.attendanceType.createMany({ data: attendanceTypes })

  // Seed expense categories
  const expenseCategories = [
    { name: "Аренда", isSalary: false, isVariable: false, isSystem: true, sortOrder: 1 },
    { name: "Коммунальные услуги", isSalary: false, isVariable: false, isSystem: true, sortOrder: 2 },
    { name: "Интернет и связь", isSalary: false, isVariable: false, isSystem: true, sortOrder: 3 },
    { name: "Канцтовары", isSalary: false, isVariable: true, isSystem: true, sortOrder: 4 },
    { name: "Учебные материалы", isSalary: false, isVariable: true, isSystem: true, sortOrder: 5 },
    { name: "Хозтовары", isSalary: false, isVariable: true, isSystem: true, sortOrder: 6 },
    { name: "Реклама", isSalary: false, isVariable: false, isSystem: true, sortOrder: 7 },
    { name: "Ремонт", isSalary: false, isVariable: false, isSystem: true, sortOrder: 8 },
    { name: "Оборудование", isSalary: false, isVariable: false, isSystem: true, sortOrder: 9 },
    { name: "Налоги и сборы", isSalary: false, isVariable: false, isSystem: true, sortOrder: 10 },
    { name: "Банковское обслуживание", isSalary: false, isVariable: false, isSystem: true, sortOrder: 11 },
    { name: "Транспорт", isSalary: false, isVariable: true, isSystem: true, sortOrder: 12 },
    { name: "Питание", isSalary: false, isVariable: true, isSystem: true, sortOrder: 13 },
    { name: "Прочее", isSalary: false, isVariable: false, isSystem: true, sortOrder: 14 },
  ]

  await db.expenseCategory.createMany({ data: expenseCategories })

  return NextResponse.json({
    ok: true,
    plan: plan.id,
    message: "БД очищена. Суперадмин + тариф + справочники созданы.",
  })
}
