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

  await db.$transaction(async (tx) => {
    const prev = await tx.callCampaignItem.findUnique({ where: { id: data.itemId } })

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
    if (prev && (prev.status as string) === "pending" && (data.status as string) !== "pending") {
      await tx.callCampaign.update({
        where: { id },
        data: { completedItems: { increment: 1 } },
      })
    }
  })

  return NextResponse.json({ success: true })
}
