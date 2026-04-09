import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const transferSchema = z.object({
  targetGroupId: z.string().uuid("Некорректный ID группы"),
})

// POST /api/enrollments/[id]/transfer — перевод ученика в другую группу
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const tenantId = (session.user as any).tenantId

  const body = await request.json()
  const parsed = transferSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ошибка валидации", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const { targetGroupId } = parsed.data

  // 1. Найти текущее зачисление
  const enrollment = await db.groupEnrollment.findFirst({
    where: { id, tenantId, isActive: true, deletedAt: null },
  })

  if (!enrollment) {
    return NextResponse.json(
      { error: "Зачисление не найдено или уже неактивно" },
      { status: 404 }
    )
  }

  // Нельзя переводить в ту же группу
  if (enrollment.groupId === targetGroupId) {
    return NextResponse.json(
      { error: "Ученик уже в этой группе" },
      { status: 400 }
    )
  }

  // 2. Проверить целевую группу
  const targetGroup = await db.group.findFirst({
    where: { id: targetGroupId, tenantId, deletedAt: null, isActive: true },
    include: {
      _count: { select: { enrollments: { where: { isActive: true } } } },
    },
  })

  if (!targetGroup) {
    return NextResponse.json(
      { error: "Целевая группа не найдена" },
      { status: 404 }
    )
  }

  // Проверить переполнение
  if (targetGroup._count.enrollments >= targetGroup.maxStudents) {
    return NextResponse.json(
      { error: "Целевая группа переполнена" },
      { status: 409 }
    )
  }

  // Проверить дублирование в целевой группе
  const existingInTarget = await db.groupEnrollment.findFirst({
    where: {
      groupId: targetGroupId,
      clientId: enrollment.clientId,
      wardId: enrollment.wardId ?? undefined,
      isActive: true,
      deletedAt: null,
    },
  })

  if (existingInTarget) {
    return NextResponse.json(
      { error: "Ученик уже зачислен в целевую группу" },
      { status: 409 }
    )
  }

  // 3-4. Деактивировать текущее и создать новое (транзакция)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [, newEnrollment] = await db.$transaction([
    db.groupEnrollment.update({
      where: { id },
      data: {
        isActive: false,
        withdrawnAt: today,
      },
    }),
    db.groupEnrollment.create({
      data: {
        tenantId,
        groupId: targetGroupId,
        clientId: enrollment.clientId,
        wardId: enrollment.wardId,
        selectedDays: undefined,
        enrolledAt: today,
        isActive: true,
        paymentStatus: enrollment.paymentStatus,
      },
      include: {
        client: {
          select: { id: true, firstName: true, lastName: true, phone: true },
        },
        ward: {
          select: { id: true, firstName: true, lastName: true, birthDate: true },
        },
      },
    }),
  ])

  return NextResponse.json(newEnrollment, { status: 201 })
}
