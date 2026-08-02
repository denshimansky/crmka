import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import crypto from "crypto"
import { uniqueViolationMessage } from "@/lib/employee-identity"

const createSchema = z.object({
  firstName: z.string().min(1, "Имя обязательно"),
  lastName: z.string().min(1, "Фамилия обязательна"),
  middleName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  phone: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  email: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  directionId: z.string().uuid().optional(),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")

  const where: any = {
    tenantId: session.user.tenantId,
    type: "CANDIDATE",
    deletedAt: null,
  }
  if (status) where.candidateStatus = status

  const candidates = await db.employee.findMany({
    where,
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
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(candidates)
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
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка" }, { status: 400 })
  }
  const data = parsed.data

  let candidate
  try {
    candidate = await db.employee.create({
      data: {
        tenantId: session.user.tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        middleName: data.middleName,
        phone: data.phone,
        email: data.email,
        type: "CANDIDATE",
        candidateStatus: "NEW",
        // Плейсхолдер-логин: Date.now() + рандом — под глобальным unique-индексом
        // логина иначе возможна коллизия двух кандидатов в один миллисекунд.
        login: `candidate_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        passwordHash: "",
        role: "instructor",
        interviewHistory: data.comment ? [{ date: new Date().toISOString(), comment: data.comment }] : [],
      },
    })
  } catch (e) {
    // Email кандидата под пер-тенант индексом может нарушить уникальность → 409.
    const msg = uniqueViolationMessage(e)
    if (msg) return NextResponse.json({ error: msg }, { status: 409 })
    throw e
  }

  return NextResponse.json(candidate, { status: 201 })
}
