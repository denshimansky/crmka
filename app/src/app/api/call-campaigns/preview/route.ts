import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"
import { buildScopedCampaignWhere } from "@/lib/call-campaigns/filter"

// Предпросмотр размера выборки обзвона по критериям — чтобы оператор видел,
// сколько клиентов попадёт в кампанию, до её создания (баг #44).
const previewSchema = z.object({
  funnelStatus: z.string().optional(),
  clientStatus: z.string().optional(),
  segment: z.string().optional(),
  branchId: z.string().optional(),
  minAge: z.number().int().min(0).max(120).optional(),
  maxAge: z.number().int().min(0).max(120).optional(),
  withdrawnFrom: z.string().optional(),
  withdrawnTo: z.string().optional(),
  lastContactFrom: z.string().optional(),
  lastContactTo: z.string().optional(),
  autoTriggers: z.array(z.string()).optional(),
}).optional().default({})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const parsed = previewSchema.safeParse(body?.filterCriteria ?? body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ошибка валидации" }, { status: 400 })
  }

  const where = buildScopedCampaignWhere(
    session.user.tenantId,
    (session.user as { allowedBranchIds?: string[] | null }).allowedBranchIds ?? null,
    parsed.data,
  )

  // 500 — потолок, как и при создании кампании.
  const total = await db.client.count({ where })
  return NextResponse.json({ count: Math.min(total, 500), exceeded: total > 500 })
}
