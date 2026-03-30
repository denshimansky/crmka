import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import bcrypt from "bcryptjs"
import { z } from "zod"

const updateSchema = z.object({
  firstName: z.string().min(1, "Имя обязательно").optional(),
  lastName: z.string().min(1, "Фамилия обязательна").optional(),
  middleName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).pipe(z.string().email("Некорректный email").nullable()),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  birthDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  role: z.enum(["manager", "admin", "instructor", "readonly"]).optional(),
  password: z.string().min(6, "Пароль минимум 6 символов").optional().or(z.literal("")).transform(v => v || undefined),
  branchIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверяем что сотрудник принадлежит нашей организации
  const existing = await db.employee.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  }

  // Нельзя менять роль владельца
  if (existing.role === "owner" && data.role) {
    return NextResponse.json({ error: "Нельзя изменить роль владельца" }, { status: 400 })
  }

  // Обновляем привязки к филиалам если переданы
  if (data.branchIds) {
    await db.employeeBranch.deleteMany({ where: { employeeId: id } })
    if (data.branchIds.length > 0) {
      await db.employeeBranch.createMany({
        data: data.branchIds.map(branchId => ({ employeeId: id, branchId })),
      })
    }
  }

  const employee = await db.employee.update({
    where: { id },
    data: {
      ...(data.firstName && { firstName: data.firstName }),
      ...(data.lastName && { lastName: data.lastName }),
      ...(data.middleName !== undefined && { middleName: data.middleName }),
      ...(data.email !== undefined && { email: data.email }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.birthDate !== undefined && { birthDate: data.birthDate ? new Date(data.birthDate) : null }),
      ...(data.role && { role: data.role }),
      ...(data.password && { passwordHash: await bcrypt.hash(data.password, 10) }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    },
    include: {
      employeeBranches: { include: { branch: { select: { id: true, name: true } } } },
    },
  })

  return NextResponse.json(employee)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Только владелец может удалять сотрудников" }, { status: 403 })
  }

  const { id } = await params

  const existing = await db.employee.findFirst({
    where: { id, tenantId: session.user.tenantId },
  })
  if (!existing) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  }
  if (existing.role === "owner") {
    return NextResponse.json({ error: "Нельзя удалить владельца" }, { status: 400 })
  }

  // Мягкое удаление
  await db.employee.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  })

  return NextResponse.json({ ok: true })
}
