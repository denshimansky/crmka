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
  })

  return NextResponse.json(items)
}

const updateSchema = z.object({
  itemId: z.string().uuid(),
  status: z.enum(["called", "no_answer", "callback", "completed"]),
  result: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  // Комментарий к результату обзвона ограничен 80 символами (UI). Здесь режем
  // жёстко на случай обхода клиента, чтобы в базу не попадала длинная строка.
  comment: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim().slice(0, 80) : undefined),
  // Дата следующей связи для исхода «Перезвонить» (баг #82): падает в
  // Client.nextContactDate, откуда её подхватывают автотриггеры задач.
  callbackDate: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
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

  // «Перезвонить» + дата: валидируем дату следующей связи (YYYY-MM-DD).
  let callbackDate: Date | null = null
  if (data.status === "callback" && data.callbackDate) {
    const d = new Date(data.callbackDate)
    if (!isNaN(d.getTime())) callbackDate = d
  }
  // Человекочитаемая метка даты для истории («до DD.MM.YYYY») — из самой строки,
  // без пересчёта в локальную TZ.
  const callbackDateLabel =
    callbackDate && data.callbackDate
      ? data.callbackDate.split("-").reverse().join(".")
      : null

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

      // Дата следующей связи → Client.nextContactDate. Отсюда её берут автотриггеры
      // задач (contact_date task, см. lib/tasks/contact-date-task.ts). updateMany —
      // чтобы можно было ограничить апдейт по tenantId (защита от чужого клиента).
      if (callbackDate && prev.clientId) {
        await tx.client.updateMany({
          where: { id: prev.clientId, tenantId: session.user.tenantId },
          data: { nextContactDate: callbackDate },
        })
      }

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
          // Исход «completed» = отказ клиента (баг #117).
          completed: "Отказ",
        }
        // Для «Перезвонить» добавляем в текст дату следующей связи.
        const statusText =
          data.status === "callback" && callbackDateLabel
            ? `Перезвонить до ${callbackDateLabel}`
            : statusLabels[data.status] || data.status
        // Коды результата → человекочитаемые метки для истории коммуникаций.
        const resultLabels: Record<string, string> = {
          application: "Создана заявка",
          enrolled_earlier: "Записан ранее",
          trial_scheduled: "Записан на пробное",
          sale: "Продажа",
          no_answer: "Не дозвонились",
          refused: "Отказ",
        }
        const resultText = data.result ? (resultLabels[data.result] ?? data.result) : undefined

        await tx.communication.create({
          data: {
            tenantId: session.user.tenantId,
            clientId: prev.clientId,
            type: "call_campaign_result",
            channel: "phone",
            direction: "outgoing",
            content: [statusText, resultText, data.comment].filter(Boolean).join(" — "),
            metadata: {
              campaignId: id,
              campaignName: campaign?.name,
              status: data.status,
              result: data.result,
              ...(callbackDateLabel ? { callbackDate: data.callbackDate } : {}),
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
