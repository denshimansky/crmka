import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getSession } from "@/lib/session"
import { db } from "@/lib/db"

// GET /api/groups/[id]/enrollments — список зачислений группы
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()
  const tenantId = session.user.tenantId

  const enrollments = await db.groupEnrollment.findMany({
    where: { groupId: id, tenantId, deletedAt: null },
    include: {
      client: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
      ward: {
        select: { id: true, firstName: true, lastName: true, birthDate: true },
      },
    },
    orderBy: { enrolledAt: "desc" },
  })

  return NextResponse.json(enrollments)
}

// POST /api/groups/[id]/enrollments — зачислить ученика
const enrollSchema = z.object({
  clientId: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Выберите клиента")),
  wardId: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v?.trim() === "" ? null : v?.trim() ?? null)),
  selectedDays: z.array(z.number()).nullable().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession()
  const tenantId = session.user.tenantId

  // Проверяем группу
  const group = await db.group.findFirst({
    where: { id, tenantId, deletedAt: null },
  })

  if (!group) {
    return NextResponse.json({ error: "Группа не найдена" }, { status: 404 })
  }

  const body = await request.json()
  const parsed = enrollSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { clientId, wardId, selectedDays } = parsed.data

  // Проверяем нет ли дубля
  const existing = await db.groupEnrollment.findFirst({
    where: {
      groupId: id,
      clientId,
      wardId: wardId ?? undefined,
      isActive: true,
      deletedAt: null,
    },
  })

  if (existing) {
    return NextResponse.json(
      { error: "Ученик уже зачислен в эту группу" },
      { status: 409 }
    )
  }

  const enrollment = await db.groupEnrollment.create({
    data: {
      tenantId,
      groupId: id,
      clientId,
      wardId,
      selectedDays: selectedDays ?? undefined,
      enrolledAt: new Date(),
      isActive: true,
      paymentStatus: "active",
    },
    include: {
      client: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
      ward: {
        select: { id: true, firstName: true, lastName: true, birthDate: true },
      },
    },
  })

  return NextResponse.json(enrollment, { status: 201 })
}
