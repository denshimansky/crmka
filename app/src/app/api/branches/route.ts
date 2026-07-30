import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { syncSubscriptionBranchCount } from "@/lib/sync-subscription-branches"
import { z } from "zod"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const branches = await db.branch.findMany({
    where: {
      tenantId: session.user.tenantId,
      deletedAt: null,
    },
    include: {
      rooms: { where: { deletedAt: null }, select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  })

  return NextResponse.json(branches)
}

const createSchema = z.object({
  name: z.string({ required_error: "Название обязательно" }).min(1, "Название обязательно"),
  address: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  workingHoursStart: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
  workingHoursEnd: z.any().transform(v => (typeof v === "string" && v.trim()) ? v.trim() : undefined),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const branch = await db.branch.create({
    data: {
      tenantId: session.user.tenantId,
      name: parsed.data.name,
      address: parsed.data.address,
      workingHoursStart: parsed.data.workingHoursStart,
      workingHoursEnd: parsed.data.workingHoursEnd,
    },
  })

  await syncSubscriptionBranchCount(session.user.tenantId)

  return NextResponse.json(branch, { status: 201 })
}
