import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const filter = searchParams.get("filter") || "all"

  const where: any = { campaignId: id, tenantId: session.user.tenantId }
  if (filter === "pending") where.status = "pending"
  if (filter === "completed") where.status = { in: ["called", "completed"] }

  const items = await db.callCampaignItem.findMany({
    where,
    include: {
      client: {
        select: {
          id: true, firstName: true, lastName: true, phone: true,
          wards: { select: { firstName: true, birthDate: true }, take: 1 },
        },
      },
    },
    orderBy: { status: "asc" },
    take: 500,
  })

  return NextResponse.json(items)
}

const updateSchema = z.object({
  itemId: z.string().uuid(),
  status: z.enum(["called", "no_answer", "callback", "completed"]),
  result: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка" }, { status: 400 })
  }
  const data = parsed.data

  try {
    await db.$transaction(async (tx) => {
      const prev = await tx.callCampaignItem.findFirst({
        where: { id: data.itemId, tenantId: session.user.tenantId },
      })
      if (!prev) throw new Error("NOT_FOUND")

      await tx.callCampaignItem.update({
        where: { id: data.itemId },
        data: {
          status: data.status,
          result: data.result,
          comment: data.comment,
          calledBy: session.user.employeeId,
          calledAt: new Date(),
        },
      })

      // Обновляем счётчик кампании
      if ((prev.status as string) === "pending" && (data.status as string) !== "pending") {
        await tx.callCampaign.update({
          where: { id },
          data: { completedItems: { increment: 1 } },
        })
      }

      // CALL-04: запись результата обзвона в Communication историю клиента
      if (prev.clientId) {
        const campaign = await tx.callCampaign.findUnique({
          where: { id },
          select: { name: true },
        })

        const statusLabels: Record<string, string> = {
          called: "Дозвонились",
          no_answer: "Не ответил",
          callback: "Перезвонить",
          completed: "Завершён",
        }

        await tx.communication.create({
          data: {
            tenantId: session.user.tenantId,
            clientId: prev.clientId,
            type: "call_campaign_result",
            channel: "phone",
            direction: "outgoing",
            content: [statusLabels[data.status] || data.status, data.result, data.comment].filter(Boolean).join(" — "),
            metadata: {
              campaignId: id,
              campaignName: campaign?.name,
              status: data.status,
              result: data.result,
            },
            employeeId: session.user.employeeId || undefined,
          },
        })
      }
    })
  } catch (e: any) {
    if (e.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
    }
    throw e
  }

  return NextResponse.json({ success: true })
}
