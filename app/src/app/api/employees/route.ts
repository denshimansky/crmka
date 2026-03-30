import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import bcrypt from "bcryptjs"
import { z } from "zod"

const createSchema = z.object({
  login: z.string().min(2).regex(/^[a-zA-Z0-9._-]+$/, "Только латиница, цифры, точка, дефис, подчёркивание"),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(["manager", "admin", "instructor", "readonly"]),
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
  const data = createSchema.parse(body)

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
      role: data.role,
      employeeBranches: data.branchIds?.length
        ? { create: data.branchIds.map((branchId) => ({ branchId })) }
        : undefined,
    },
    include: {
      employeeBranches: { include: { branch: { select: { id: true, name: true } } } },
    },
  })

  return NextResponse.json(employee, { status: 201 })
}
