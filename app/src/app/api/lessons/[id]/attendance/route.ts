import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { isPeriodLocked } from "@/lib/period-check"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { logAudit } from "@/lib/audit"

const markSchema = z.object({
  clientId: z.string().uuid("Некорректный ID клиента"),
  wardId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  subscriptionId: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : null),
  attendanceTypeId: z.string().uuid("Некорректный тип посещения"),
  instructorPayEnabled: z.boolean().default(true),
})

const bulkSchema = z.object({
  attendanceTypeId: z.string().uuid("Некорректный тип посещения"),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId

  const body = await req.json()
  const parsed = markSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Verify lesson exists and belongs to tenant
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    include: {
      group: {
        include: { direction: true },
      },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // Проверка закрытия периода
  const role = (session.user as any).role
  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Get attendance type
  const attendanceType = await db.attendanceType.findFirst({
    where: {
      id: data.attendanceTypeId,
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
  })
  if (!attendanceType) return NextResponse.json({ error: "Тип посещения не найден" }, { status: 404 })

  // === Вся бизнес-логика в транзакции ===
  const attendance = await db.$transaction(async (tx) => {
    // Calculate charge amount
    let chargeAmount = new Prisma.Decimal(0)
    let subscriptionId = data.subscriptionId

    if (attendanceType.chargesSubscription && subscriptionId) {
      const subscription = await tx.subscription.findFirst({
        where: { id: subscriptionId, tenantId, deletedAt: null, status: { in: ["active", "pending"] } },
      })
      if (subscription) {
        chargeAmount = subscription.lessonPrice
      }
    } else if (attendanceType.chargesSubscription && !subscriptionId) {
      const lessonDate = new Date(lesson.date)
      const subscription = await tx.subscription.findFirst({
        where: {
          tenantId,
          clientId: data.clientId,
          groupId: lesson.groupId,
          periodYear: lessonDate.getFullYear(),
          periodMonth: lessonDate.getMonth() + 1,
          deletedAt: null,
          status: { in: ["active", "pending"] },
          ...(data.wardId ? { wardId: data.wardId } : {}),
        },
      })
      if (subscription) {
        subscriptionId = subscription.id
        chargeAmount = subscription.lessonPrice
      }
    }

    // Calculate instructor pay
    let instructorPayAmount = new Prisma.Decimal(0)
    if (attendanceType.paysInstructor && data.instructorPayEnabled) {
      const salaryRate = await tx.salaryRate.findFirst({
        where: {
          tenantId,
          employeeId: lesson.substituteInstructorId || lesson.instructorId,
          directionId: lesson.group.directionId,
        },
      })
      if (salaryRate) {
        if (salaryRate.scheme === "per_student" && salaryRate.ratePerStudent) {
          instructorPayAmount = salaryRate.ratePerStudent
        } else if (salaryRate.scheme === "per_lesson" && salaryRate.ratePerLesson) {
          const existingCount = await tx.attendance.count({
            where: {
              lessonId,
              attendanceType: { paysInstructor: true },
              instructorPayEnabled: true,
              clientId: { not: data.clientId },
            },
          })
          if (existingCount === 0) {
            instructorPayAmount = salaryRate.ratePerLesson
          }
        } else if (salaryRate.scheme === "fixed_plus_per_student") {
          if (salaryRate.ratePerStudent) {
            instructorPayAmount = salaryRate.ratePerStudent
          }
        }
      }
    }

    // Upsert attendance
    let att
    if (subscriptionId) {
      const existing = await tx.attendance.findUnique({
        where: { tenantId_lessonId_subscriptionId: { tenantId, lessonId, subscriptionId } },
      })

      if (existing) {
        // Reverse previous charge
        if (existing.subscriptionId && Number(existing.chargeAmount) > 0) {
          await tx.subscription.update({
            where: { id: existing.subscriptionId },
            data: {
              balance: { increment: existing.chargeAmount },
              chargedAmount: { decrement: existing.chargeAmount },
            },
          })
        }

        att = await tx.attendance.update({
          where: { id: existing.id },
          data: {
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount,
            instructorPayAmount,
            instructorPayEnabled: data.instructorPayEnabled,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      } else {
        att = await tx.attendance.create({
          data: {
            tenantId,
            lessonId,
            subscriptionId,
            clientId: data.clientId,
            wardId: data.wardId,
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount,
            instructorPayAmount,
            instructorPayEnabled: data.instructorPayEnabled,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      }

      // Debit subscription
      if (attendanceType.chargesSubscription && Number(chargeAmount) > 0) {
        await tx.subscription.update({
          where: { id: subscriptionId },
          data: {
            balance: { decrement: chargeAmount },
            chargedAmount: { increment: chargeAmount },
          },
        })

        // Lead→Client conversion: первое платное посещение конвертирует лида
        const client = await tx.client.findUnique({ where: { id: data.clientId } })
        if (client && client.funnelStatus !== "active_client" && client.clientStatus !== "active") {
          await tx.client.update({
            where: { id: data.clientId },
            data: {
              funnelStatus: "active_client",
              clientStatus: "active",
            },
          })
        }
      }
    } else {
      // No subscription
      const existing = await tx.attendance.findFirst({
        where: {
          lessonId,
          clientId: data.clientId,
          wardId: data.wardId,
          subscriptionId: null,
        },
      })

      if (existing) {
        att = await tx.attendance.update({
          where: { id: existing.id },
          data: {
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount: 0,
            instructorPayAmount,
            instructorPayEnabled: data.instructorPayEnabled,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      } else {
        att = await tx.attendance.create({
          data: {
            tenantId,
            lessonId,
            subscriptionId: null,
            clientId: data.clientId,
            wardId: data.wardId,
            attendanceTypeId: data.attendanceTypeId,
            chargeAmount: 0,
            instructorPayAmount,
            instructorPayEnabled: data.instructorPayEnabled,
            markedBy: employeeId,
            markedAt: new Date(),
          },
        })
      }
    }

    return att
  })

  logAudit({
    tenantId,
    employeeId,
    action: "create",
    entityType: "Attendance",
    entityId: attendance.id,
    changes: { lessonId: { new: lessonId }, clientId: { new: data.clientId }, attendanceTypeId: { new: data.attendanceTypeId } },
    req,
  })

  return NextResponse.json(attendance)
}

// PUT: Mark ALL students as present (bulk)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId
  const employeeId = (session.user as any).employeeId

  const body = await req.json()
  const parsed = bulkSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const role = (session.user as any).role

  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    include: {
      group: { include: { direction: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  const attendanceType = await db.attendanceType.findFirst({
    where: {
      id: parsed.data.attendanceTypeId,
      OR: [{ tenantId: null }, { tenantId }],
      isActive: true,
    },
  })
  if (!attendanceType) return NextResponse.json({ error: "Тип посещения не найден" }, { status: 404 })

  // Проверка закрытия периода
  if (await isPeriodLocked(tenantId, new Date(lesson.date), role)) {
    return NextResponse.json({ error: "Период закрыт. Обратитесь к владельцу или управляющему." }, { status: 403 })
  }

  // Get all active enrollments
  const enrollments = await db.groupEnrollment.findMany({
    where: {
      groupId: lesson.groupId,
      tenantId,
      isActive: true,
      deletedAt: null,
    },
  })

  // Get subscriptions for this period
  const lessonDate = new Date(lesson.date)
  const subscriptions = await db.subscription.findMany({
    where: {
      tenantId,
      groupId: lesson.groupId,
      periodYear: lessonDate.getFullYear(),
      periodMonth: lessonDate.getMonth() + 1,
      deletedAt: null,
      status: { in: ["active", "pending"] },
    },
  })

  // Get salary rate
  const salaryRate = await db.salaryRate.findFirst({
    where: {
      tenantId,
      employeeId: lesson.instructorId,
      directionId: lesson.group.directionId,
    },
  })

  // === Предзагрузка existing attendances (batch вместо N+1) ===
  const existingAttendances = await db.attendance.findMany({
    where: { lessonId, tenantId },
  })

  // === Вся bulk-логика в одной транзакции ===
  const results = await db.$transaction(async (tx) => {
    const atts = []
    let isFirstForLesson = true

    for (const enrollment of enrollments) {
      const subscription = subscriptions.find(
        (s) => s.clientId === enrollment.clientId && (
          enrollment.wardId ? s.wardId === enrollment.wardId : !s.wardId
        )
      )

      let chargeAmount = new Prisma.Decimal(0)
      if (attendanceType.chargesSubscription && subscription) {
        chargeAmount = subscription.lessonPrice
      }

      let instructorPayAmount = new Prisma.Decimal(0)
      if (attendanceType.paysInstructor && salaryRate) {
        if (salaryRate.scheme === "per_student" && salaryRate.ratePerStudent) {
          instructorPayAmount = salaryRate.ratePerStudent
        } else if (salaryRate.scheme === "per_lesson" && salaryRate.ratePerLesson && isFirstForLesson) {
          instructorPayAmount = salaryRate.ratePerLesson
          isFirstForLesson = false
        } else if (salaryRate.scheme === "fixed_plus_per_student" && salaryRate.ratePerStudent) {
          instructorPayAmount = salaryRate.ratePerStudent
        }
      }

      const subscriptionId = subscription?.id || null

      if (subscriptionId) {
        // Ищем в предзагруженных (вместо N отдельных запросов)
        const existing = existingAttendances.find(
          (a) => a.subscriptionId === subscriptionId
        )

        if (existing) {
          // Reverse previous charge
          if (existing.subscriptionId && Number(existing.chargeAmount) > 0) {
            await tx.subscription.update({
              where: { id: existing.subscriptionId },
              data: {
                balance: { increment: existing.chargeAmount },
                chargedAmount: { decrement: existing.chargeAmount },
              },
            })
          }

          const att = await tx.attendance.update({
            where: { id: existing.id },
            data: {
              attendanceTypeId: parsed.data.attendanceTypeId,
              chargeAmount,
              instructorPayAmount,
              instructorPayEnabled: true,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
          atts.push(att)
        } else {
          const att = await tx.attendance.create({
            data: {
              tenantId,
              lessonId,
              subscriptionId,
              clientId: enrollment.clientId,
              wardId: enrollment.wardId,
              attendanceTypeId: parsed.data.attendanceTypeId,
              chargeAmount,
              instructorPayAmount,
              instructorPayEnabled: true,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
          atts.push(att)
        }

        // Debit subscription
        if (attendanceType.chargesSubscription && Number(chargeAmount) > 0) {
          await tx.subscription.update({
            where: { id: subscriptionId },
            data: {
              balance: { decrement: chargeAmount },
              chargedAmount: { increment: chargeAmount },
            },
          })
        }
      } else {
        // No subscription — ищем в предзагруженных
        const existing = existingAttendances.find(
          (a) => a.clientId === enrollment.clientId &&
            a.wardId === enrollment.wardId &&
            a.subscriptionId === null
        )

        if (existing) {
          const att = await tx.attendance.update({
            where: { id: existing.id },
            data: {
              attendanceTypeId: parsed.data.attendanceTypeId,
              chargeAmount: 0,
              instructorPayAmount,
              instructorPayEnabled: true,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
          atts.push(att)
        } else {
          const att = await tx.attendance.create({
            data: {
              tenantId,
              lessonId,
              subscriptionId: null,
              clientId: enrollment.clientId,
              wardId: enrollment.wardId,
              attendanceTypeId: parsed.data.attendanceTypeId,
              chargeAmount: 0,
              instructorPayAmount,
              instructorPayEnabled: true,
              markedBy: employeeId,
              markedAt: new Date(),
            },
          })
          atts.push(att)
        }
      }
    }

    return atts
  })

  logAudit({
    tenantId,
    employeeId,
    action: "create",
    entityType: "Attendance",
    entityId: lessonId,
    changes: { bulk: { new: true }, count: { new: results.length }, attendanceTypeId: { new: parsed.data.attendanceTypeId } },
    req,
  })

  return NextResponse.json({ count: results.length, attendances: results })
}

// PATCH: Update absence reason on an attendance record
const patchSchema = z.object({
  attendanceId: z.string().uuid(),
  absenceReasonId: z.string().uuid().nullable(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId

  const body = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ошибка валидации" }, { status: 400 })
  }

  const existing = await db.attendance.findFirst({
    where: { id: parsed.data.attendanceId, lessonId, tenantId },
  })
  if (!existing) return NextResponse.json({ error: "Отметка не найдена" }, { status: 404 })

  const updated = await db.attendance.update({
    where: { id: parsed.data.attendanceId },
    data: { absenceReasonId: parsed.data.absenceReasonId },
  })

  return NextResponse.json(updated)
}
