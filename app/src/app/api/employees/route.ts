import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { requirePermission } from "@/lib/api-permissions"
import { isLoginTaken, isEmailTaken, LOGIN_TAKEN_MSG, EMAIL_TAKEN_MSG, uniqueViolationMessage } from "@/lib/employee-identity"

const createSchema = z.object({
  login: z.string({ required_error: "Логин обязателен" }).min(2, "Логин минимум 2 символа").regex(/^[a-zA-Z0-9._-]+$/, "Только латиница, цифры, точка, дефис, подчёркивание"),
  password: z.string({ required_error: "Пароль обязателен" }).min(6, "Пароль минимум 6 символов"),
  firstName: z.string({ required_error: "Имя обязательно" }).min(1, "Имя обязательно"),
  lastName: z.string({ required_error: "Фамилия обязательна" }).min(1, "Фамилия обязательна"),
  middleName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined).pipe(z.string().email("Некорректный email").optional()),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  birthDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  role: z.enum(["manager", "admin", "instructor", "readonly"], { required_error: "Выберите роль" }),
  branchIds: z.array(z.string().uuid()).optional(),
})

export async function GET() {
  const guard = await requirePermission("staff.view")
  if (!guard.ok) return guard.response
  const session = guard.session

  const employees = await db.employee.findMany({
    where: { tenantId: session.user.tenantId, deletedAt: null },
    include: {
      employeeBranches: { include: { branch: { select: { id: true, name: true } } } },
      salaryRates: { include: { direction: { select: { id: true, name: true } } } },
    },
    orderBy: [{ role: "asc" }, { lastName: "asc" }],
  })

  return NextResponse.json(employees)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]
    return NextResponse.json({ error: firstError?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // ADM-04: для admin требуем ≥1 филиал при создании — без привязок он видел бы
  // данные всех филиалов. Инструктору филиал необязателен: его видимость и так
  // ограничена своими занятиями (scopeLessonForInstructor). Для существующих
  // сотрудников без привязок политика не меняется (см. branch-scope.ts).
  if (data.role === "admin" && (!data.branchIds || data.branchIds.length === 0)) {
    return NextResponse.json(
      { error: "Для роли «администратор» нужно выбрать хотя бы один филиал" },
      { status: 400 },
    )
  }

  // Логин — глобально уникален (регистро-/пробелонезависимо). Вход по логину
  // ищет по всей системе, поэтому одинаковый логин в разных центрах ломал бы вход.
  if (await isLoginTaken(db, data.login)) {
    return NextResponse.json({ error: LOGIN_TAKEN_MSG }, { status: 409 })
  }

  // Email уникален в рамках центра (регистро-/пробелонезависимо) — второй способ
  // входа и адрес для сброса пароля.
  if (data.email && (await isEmailTaken(db, data.email, session.user.tenantId))) {
    return NextResponse.json({ error: EMAIL_TAKEN_MSG }, { status: 409 })
  }

  let employee
  try {
    employee = await db.employee.create({
      data: {
        tenantId: session.user.tenantId,
        login: data.login.trim(),
        passwordHash: await bcrypt.hash(data.password, 10),
        firstName: data.firstName,
        lastName: data.lastName,
        middleName: data.middleName,
        email: data.email,
        phone: data.phone,
        birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
        role: data.role,
        employeeBranches: data.branchIds?.length
          ? { create: data.branchIds.map((branchId) => ({ tenantId: session.user.tenantId, branchId })) }
          : undefined,
      },
      include: {
        employeeBranches: { include: { branch: { select: { id: true, name: true } } } },
      },
    })
  } catch (e) {
    // Гонка между isLoginTaken/isEmailTaken и вставкой (TOCTOU) → БД-индекс → 409.
    const msg = uniqueViolationMessage(e)
    if (msg) return NextResponse.json({ error: msg }, { status: 409 })
    throw e
  }

  return NextResponse.json(employee, { status: 201 })
}
