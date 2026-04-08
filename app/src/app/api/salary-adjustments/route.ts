import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  employeeId: z.string().uuid("Выберите сотрудника"),
  type: z.enum(["bonus", "penalty"], {
    errorMap: () => ({ message: "Выберите тип" }),
  }),
  amount: z.number().min(0.01, "Сумма должна быть больше 0"),
  periodYear: z.number().int(),
  periodMonth: z.number().int().min(1).max(12),
  comment: z.string().min(1, "Комментарий обязателен"),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const periodYear = Number(searchParams.get("periodYear")) || new Date().getFullYear()
  const periodMonth = Number(searchParams.get("periodMonth")) || new Date().getMonth() + 1
  const employeeId = searchParams.get("employeeId")

  const where: any = {
    tenantId: session.user.tenantId,
    periodYear,
    periodMonth,
  }
  if (employeeId) where.employeeId = employeeId

  const adjustments = await db.salaryAdjustment.findMany({
    where,
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(adjustments)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Проверка принадлежности сотрудника к тенанту
  const employee = await db.employee.findFirst({
    where: { id: data.employeeId, tenantId: session.user.tenantId },
  })
  if (!employee) return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })

  const adjustment = await db.salaryAdjustment.create({
    data: {
      tenantId: session.user.tenantId,
      employeeId: data.employeeId,
      type: data.type,
      amount: data.amount,
      periodYear: data.periodYear,
      periodMonth: data.periodMonth,
      comment: data.comment,
      createdBy: session.user.employeeId,
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true } },
    },
  })

  return NextResponse.json(adjustment, { status: 201 })
}
