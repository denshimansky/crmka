import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { createTrialLessonForClient } from "@/lib/services/trial-lesson"

const trialPayloadSchema = z.object({
  groupId: z.string().uuid().optional(),
  directionId: z.string().uuid().optional(),
  instructorId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата формата YYYY-MM-DD"),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Время формата HH:MM").optional(),
  durationMinutes: z.number().int().min(15).max(480).optional(),
  comment: z.string().optional(),
})

const processSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("lead") }),
  z.object({ outcome: z.literal("potential") }),
  z.object({ outcome: z.literal("trial"), trialPayload: trialPayloadSchema }),
])

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = processSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data
  const tenantId = session.user.tenantId
  const employeeId = session.user.employeeId ?? null

  const application = await db.application.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      status: true,
      client: { select: { id: true, clientStatus: true } },
    },
  })
  if (!application) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 })
  if (application.status !== "active") {
    return NextResponse.json({ error: "Заявка уже обработана" }, { status: 409 })
  }

  if (data.outcome === "trial") {
    const result = await createTrialLessonForClient(
      tenantId,
      employeeId,
      {
        clientId: application.clientId,
        wardId: application.wardId,
        ...data.trialPayload,
      },
      { applicationId: id },
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    if (employeeId) {
      await db.auditLog.create({
        data: {
          tenantId,
          employeeId,
          action: "update",
          entityType: "Application",
          entityId: id,
          changes: { status: { old: "active", new: "processed" }, processedToStatus: { old: null, new: "trial" } },
        },
      })
    }
    return NextResponse.json({ ok: true, outcome: "trial", trial: result.trial })
  }

  const newFunnelStatus = data.outcome === "lead" ? "new" : "potential"
  const isActiveClient = application.client.clientStatus === "active"

  await db.$transaction(async (tx) => {
    await tx.application.update({
      where: { id },
      data: {
        status: "processed",
        processedToStatus: data.outcome,
        processedAt: new Date(),
        processedBy: employeeId ?? undefined,
      },
    })
    if (!isActiveClient) {
      await tx.client.update({
        where: { id: application.clientId },
        data: { funnelStatus: newFunnelStatus },
      })
    }
  })

  if (employeeId) {
    await db.auditLog.create({
      data: {
        tenantId,
        employeeId,
        action: "update",
        entityType: "Application",
        entityId: id,
        changes: {
          status: { old: "active", new: "processed" },
          processedToStatus: { old: null, new: data.outcome },
        },
      },
    })
  }

  return NextResponse.json({ ok: true, outcome: data.outcome })
}
