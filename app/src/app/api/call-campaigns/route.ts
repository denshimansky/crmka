import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { buildScopedCampaignWhere, campaignFilterSchema } from "@/lib/call-campaigns/filter"

const createSchema = z.object({
  name: z.string().min(1, "Введите название"),
  filterCriteria: campaignFilterSchema.optional().default({}),
})

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const campaigns = await db.callCampaign.findMany({
    where: { tenantId: session.user.tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return NextResponse.json(campaigns)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }
  const data = parsed.data

  // Обзвон по задачам без выбранных типов — пустая кампания, запрещаем явно.
  const fc = data.filterCriteria
  if (fc.mode === "tasks" && (!fc.autoTriggers || fc.autoTriggers.length === 0)) {
    return NextResponse.json({ error: "Выберите хотя бы один тип задач" }, { status: 400 })
  }

  const where = buildScopedCampaignWhere(
    session.user.tenantId,
    (session.user as { allowedBranchIds?: string[] | null }).allowedBranchIds ?? null,
    data.filterCriteria,
  )

  const clients = await db.client.findMany({
    where,
    select: { id: true },
    take: 500,
  })

  const campaign = await db.$transaction(async (tx) => {
    const c = await tx.callCampaign.create({
      data: {
        tenantId: session.user.tenantId,
        name: data.name,
        status: "active",
        filterCriteria: data.filterCriteria,
        totalItems: clients.length,
        completedItems: 0,
        createdBy: session.user.employeeId,
      },
    })

    if (clients.length > 0) {
      await tx.callCampaignItem.createMany({
        data: clients.map((cl) => ({
          tenantId: session.user.tenantId,
          campaignId: c.id,
          clientId: cl.id,
          status: "pending" as const,
        })),
      })
    }

    return c
  })

  return NextResponse.json(campaign, { status: 201 })
}
