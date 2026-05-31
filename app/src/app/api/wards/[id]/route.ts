import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { Prisma } from "@prisma/client"
import { z } from "zod"

const updateSchema = z.object({
  firstName: z.string().min(1, "Имя обязательно").optional(),
  lastName: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).optional(),
  birthDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).optional(),
  notes: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null).optional(),
  salesStage: z
    .enum(["none", "application", "trial_scheduled", "trial_attended", "awaiting_payment"])
    .optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const ward = await db.ward.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: {
      client: {
        select: { id: true, firstName: true, lastName: true, patronymic: true, phone: true },
      },
    },
  })
  if (!ward) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })

  return NextResponse.json({
    ...ward,
    client: { ...ward.client, phone: maskPhone(ward.client.phone, session.user.role) },
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  const existing = await db.ward.findFirst({
    where: { id, tenantId: session.user.tenantId },
    select: { id: true, clientId: true, salesStage: true },
  })
  if (!existing) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })

  const stageChanged =
    data.salesStage !== undefined && data.salesStage !== existing.salesStage
  const now = new Date()
  const tenantId = session.user.tenantId

  // Если стадия переезжает в trial_attended или awaiting_payment, а связанный
  // scheduled-пробный ещё не отмечен — синхронизируем его (status=attended,
  // attendedAt, Attendance). Иначе на вкладках «Прошёл пробное» / «Ожидаем оплату»
  // у строки пропадут филиал/направление/группа — они подтягиваются из TrialLesson.
  const shouldMarkAttended =
    stageChanged &&
    (data.salesStage === "trial_attended" || data.salesStage === "awaiting_payment")

  const ward = await db.$transaction(async (tx) => {
    const w = await tx.ward.update({
      where: { id },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.birthDate !== undefined && { birthDate: data.birthDate ? new Date(data.birthDate) : null }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(stageChanged && { salesStage: data.salesStage!, salesStageAt: now }),
      },
    })

    if (shouldMarkAttended) {
      const scheduled = await tx.trialLesson.findFirst({
        where: { tenantId, wardId: id, status: "scheduled" },
        orderBy: { scheduledDate: "desc" },
        include: {
          lesson: { select: { id: true } },
        },
      })
      if (scheduled) {
        await tx.trialLesson.update({
          where: { id: scheduled.id },
          data: { status: "attended", attendedAt: now },
        })

        // Создаём Attendance(isTrial=true) — как в PATCH /api/trial-lessons/[id].
        // Salary за пробное не считаем здесь: его проще будет пересчитать через
        // обычный flow при необходимости. Делаем минимальный корректный набор.
        if (scheduled.lesson) {
          const presentType = await tx.attendanceType.findFirst({
            where: { OR: [{ tenantId: null }, { tenantId }], code: "present", isActive: true },
          })
          if (presentType) {
            const existingAtt = await tx.attendance.findFirst({
              where: {
                tenantId,
                lessonId: scheduled.lesson.id,
                clientId: existing.clientId,
                wardId: id,
                isTrial: true,
              },
            })
            if (!existingAtt) {
              await tx.attendance.create({
                data: {
                  tenantId,
                  lessonId: scheduled.lesson.id,
                  clientId: existing.clientId,
                  wardId: id,
                  attendanceTypeId: presentType.id,
                  chargeAmount: new Prisma.Decimal(0),
                  instructorPayAmount: new Prisma.Decimal(0),
                  instructorPayEnabled: scheduled.instructorPayEnabled,
                  isTrial: true,
                  markedBy: session.user.employeeId ?? undefined,
                  markedAt: now,
                },
              })
            }
          }
        }

        // Закрываем фантомные напоминания о пробном.
        await tx.task.updateMany({
          where: {
            tenantId,
            clientId: existing.clientId,
            autoTrigger: "trial_reminder",
            status: "pending",
            deletedAt: null,
          },
          data: {
            status: "completed",
            completedAt: now,
            completedBy: session.user.employeeId ?? undefined,
          },
        })
      }
    }

    return w
  })

  if (stageChanged && session.user.employeeId) {
    await db.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "update",
        entityType: "Ward",
        entityId: id,
        changes: {
          salesStage: { old: existing.salesStage, new: data.salesStage },
        },
      },
    })
  }

  return NextResponse.json(ward)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const { id } = await params

  const existing = await db.ward.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: {
      _count: { select: { subscriptions: true, enrollments: true, trialLessons: true, applications: true } },
    },
  })
  if (!existing) return NextResponse.json({ error: "Подопечный не найден" }, { status: 404 })

  const hasLinks =
    existing._count.subscriptions > 0 ||
    existing._count.enrollments > 0 ||
    existing._count.trialLessons > 0 ||
    existing._count.applications > 0
  if (hasLinks) {
    return NextResponse.json(
      { error: "Нельзя удалить подопечного: есть связанные абонементы, зачисления, пробные или заявки" },
      { status: 400 },
    )
  }

  await db.ward.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
