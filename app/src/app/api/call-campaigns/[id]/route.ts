import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const campaign = await db.callCampaign.findFirst({
    where: { id, tenantId: session.user.tenantId, deletedAt: null },
  })
  if (!campaign) return NextResponse.json({ error: "Кампания не найдена" }, { status: 404 })

  return NextResponse.json(campaign)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const campaign = await db.callCampaign.update({
    where: { id },
    data: { status: body.status },
  })

  return NextResponse.json(campaign)
}
