import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import bcrypt from "bcryptjs"

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  middleName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  candidateStatus: z.enum(["NEW", "INTERVIEW", "TRIAL_DAY", "HIRED", "REJECTED"]).optional(),
  resumeUrl: z.string().optional(),
  comment: z.string().optional(),
})

const hireSchema = z.object({
  login: z.string().min(2).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(6),
  role: z.enum(["manager", "admin", "instructor", "readonly"]),
  branchIds: z.array(z.string().uuid()).optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const candidate = await db.employee.findFirst({
    where: { id, tenantId: session.user.tenantId, type: "CANDIDATE", deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      middleName: true,
      phone: true,
      email: true,
      candidateStatus: true,
      interviewHistory: true,
      resumeUrl: true,
      createdAt: true,
    },
  })

  if (!candidate) return NextResponse.json({ error: "Не найден" }, { status: 404 })
  return NextResponse.json(candidate)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка" }, { status: 400 })
  }
  const data = parsed.data

  const candidate = await db.employee.findFirst({
    where: { id, tenantId: session.user.tenantId, type: "CANDIDATE", deletedAt: null },
  })
  if (!candidate) return NextResponse.json({ error: "Не найден" }, { status: 404 })

  // Добавить встречу в историю
  const updateData: any = {}
  if (data.firstName) updateData.firstName = data.firstName
  if (data.lastName) updateData.lastName = data.lastName
  if (data.middleName !== undefined) updateData.middleName = data.middleName || null
  if (data.phone !== undefined) updateData.phone = data.phone || null
  if (data.email !== undefined) updateData.email = data.email || null
  if (data.candidateStatus) updateData.candidateStatus = data.candidateStatus
  if (data.resumeUrl !== undefined) updateData.resumeUrl = data.resumeUrl || null

  if (data.comment) {
    const history = (candidate.interviewHistory as any[]) || []
    history.push({ date: new Date().toISOString(), comment: data.comment })
    updateData.interviewHistory = history
  }

  const updated = await db.employee.update({
    where: { id },
    data: updateData,
  })

  return NextResponse.json(updated)
}

// POST /api/candidates/[id] — перевод кандидата в сотрудники (HIRED)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = hireSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка" }, { status: 400 })
  }
  const data = parsed.data

  const candidate = await db.employee.findFirst({
    where: { id, tenantId: session.user.tenantId, type: "CANDIDATE", deletedAt: null },
  })
  if (!candidate) return NextResponse.json({ error: "Не найден" }, { status: 404 })

  // Проверяем уникальность логина
  const existing = await db.employee.findFirst({
    where: { tenantId: session.user.tenantId, login: data.login, deletedAt: null, id: { not: id } },
  })
  if (existing) return NextResponse.json({ error: "Логин уже занят" }, { status: 409 })

  const passwordHash = await bcrypt.hash(data.password, 12)

  await db.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id },
      data: {
        type: "ACTIVE",
        candidateStatus: "HIRED",
        login: data.login,
        passwordHash,
        role: data.role,
        hireDate: new Date(),
      },
    })

    if (data.branchIds?.length) {
      await tx.employeeBranch.createMany({
        data: data.branchIds.map(branchId => ({
          employeeId: id,
          tenantId: session.user.tenantId,
          branchId,
        })),
      })
    }
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  await db.employee.updateMany({
    where: { id, tenantId: session.user.tenantId, type: "CANDIDATE" },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ success: true })
}
