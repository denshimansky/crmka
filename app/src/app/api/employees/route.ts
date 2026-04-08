import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import bcrypt from "bcryptjs"
import { z } from "zod"

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
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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

  // Проверяем уникальность логина
  const existing = await db.employee.findFirst({
    where: { tenantId: session.user.tenantId, login: data.login, deletedAt: null },
  })
  if (existing) {
    return NextResponse.json({ error: "Логин уже занят" }, { status: 409 })
  }

  const employee = await db.employee.create({
    data: {
      tenantId: session.user.tenantId,
      login: data.login,
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

  return NextResponse.json(employee, { status: 201 })
}
