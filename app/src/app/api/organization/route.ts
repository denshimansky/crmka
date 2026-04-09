import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().optional(),
  inn: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  salaryDay1: z.number().min(1).max(28).optional(),
  salaryDay2: z.number().min(1).max(31).optional(),
  payForAbsence: z.boolean().optional(),
  attendanceDeadline: z.number().min(1).max(90).optional(),
  roleDisplayNames: z.record(z.string()).optional(),
  onboardingCompleted: z.boolean().optional(),
})

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await db.organization.findUnique({
    where: { id: session.user.tenantId },
    include: {
      branches: { where: { deletedAt: null }, include: { rooms: { where: { deletedAt: null } } } },
      _count: { select: { employees: true } },
    },
  })

  return NextResponse.json(org)
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const org = await db.organization.update({
    where: { id: session.user.tenantId },
    data,
  })

  return NextResponse.json(org)
}
