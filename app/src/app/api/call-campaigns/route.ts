import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { buildScopedCampaignWhere, campaignFilterSchema, wardIdsForClient } from "@/lib/call-campaigns/filter"

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

  // Лимит на размер кампании снят (баг #82): в обзвон попадают все клиенты,
  // подходящие под критерии, без потолка.
  // Одна строка = один подопечный: разворачиваем клиента в строки по подходящим
  // подопечным (при фильтре по дате рождения — только попавшим в диапазон).
  const clients = await db.client.findMany({
    where,
    select: {
      id: true,
      wards: { select: { id: true, birthDate: true } },
    },
  })
  const rows = clients.flatMap((cl) =>
    wardIdsForClient(cl.wards, data.filterCriteria).map((wardId) => ({
      tenantId: session.user.tenantId,
      clientId: cl.id,
      wardId,
      status: "pending" as const,
    })),
  )

  const campaign = await db.$transaction(async (tx) => {
    const c = await tx.callCampaign.create({
      data: {
        tenantId: session.user.tenantId,
        name: data.name,
        status: "active",
        filterCriteria: data.filterCriteria,
        totalItems: rows.length,
        completedItems: 0,
        createdBy: session.user.employeeId,
      },
    })

    if (rows.length > 0) {
      await tx.callCampaignItem.createMany({
        data: rows.map((r) => ({ ...r, campaignId: c.id })),
      })
    }

    return c
  })

  return NextResponse.json(campaign, { status: 201 })
}
