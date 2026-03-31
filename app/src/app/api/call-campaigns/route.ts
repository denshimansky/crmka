import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  name: z.string().min(1, "Введите название"),
  filterCriteria: z.object({
    funnelStatus: z.string().optional(),
    branchId: z.string().optional(),
    segment: z.string().optional(),
  }).optional().default({}),
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

  // Формируем список клиентов по фильтру
  const clientWhere: any = {
    tenantId: session.user.tenantId,
    deletedAt: null,
  }
  if (data.filterCriteria.funnelStatus) clientWhere.funnelStatus = data.filterCriteria.funnelStatus
  if (data.filterCriteria.branchId) clientWhere.branchId = data.filterCriteria.branchId
  if (data.filterCriteria.segment) clientWhere.segment = data.filterCriteria.segment

  const clients = await db.client.findMany({
    where: clientWhere,
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
