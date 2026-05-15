import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const updateSchema = z.object({
  status: z.enum(["scheduled", "attended", "no_show", "cancelled"]),
})

// PATCH /api/trial-lessons/[id] — отметка результата пробного
// attended → автоматически переводит лида в trial_attended (если он ещё в trial_scheduled)
//            и закрывает автозадачу-напоминание
// no_show / cancelled → задача-напоминание закрывается
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const { status } = parsed.data
  const tenantId = session.user.tenantId

  const trial = await db.trialLesson.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      clientId: true,
      scheduledDate: true,
      client: { select: { funnelStatus: true } },
    },
  })
  if (!trial) return NextResponse.json({ error: "Пробное не найдено" }, { status: 404 })

  const now = new Date()

  const updated = await db.$transaction(async (tx) => {
    const t = await tx.trialLesson.update({
      where: { id },
      data: {
        status,
        attendedAt: status === "attended" ? now : null,
      },
    })

    // attended → перевести лида в trial_attended (если он ещё в trial_scheduled)
    if (status === "attended" && trial.client?.funnelStatus === "trial_scheduled") {
      await tx.client.update({
        where: { id: trial.clientId },
        data: { funnelStatus: "trial_attended" },
      })
    }

    // Закрыть открытую автозадачу-напоминание, если есть
    if (status !== "scheduled") {
      await tx.task.updateMany({
        where: {
          tenantId,
          clientId: trial.clientId,
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

    return t
  })

  return NextResponse.json(updated)
}
