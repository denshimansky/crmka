import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  applicationStageForWardScope,
  buildScopedCampaignWhere,
  campaignFilterSchema,
  wardIdsForClient,
} from "@/lib/call-campaigns/filter"

// Предпросмотр размера выборки обзвона по критериям — чтобы оператор видел,
// сколько клиентов попадёт в кампанию, до её создания (баг #44).
const previewSchema = campaignFilterSchema.optional().default({})

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

  // Потолка на размер кампании больше нет (баг #82). Одна строка = один
  // подопечный: считаем строки-подопечные (при фильтре по дате рождения — только
  // попавших в диапазон), а не клиентов — это реальный размер обзвона. Для
  // этапа-заявки сужаем до заявочных подопечных (как и при создании) — чтобы
  // счётчик совпал с фактическим числом строк.
  const stage = applicationStageForWardScope(parsed.data)
  const clients = await db.client.findMany({
    where,
    select: {
      id: true,
      wards: { select: { id: true, birthDate: true } },
      ...(stage
        ? {
            applications: {
              where: { status: "active", deletedAt: null, stage: stage as never },
              select: { wardId: true },
            },
          }
        : {}),
    },
  })
  const total = clients.reduce((sum, cl) => {
    const appWardIds = stage
      ? (cl as { applications?: { wardId: string | null }[] }).applications?.map((a) => a.wardId)
      : undefined
    return sum + wardIdsForClient(cl.wards, parsed.data, undefined, appWardIds).length
  }, 0)
  return NextResponse.json({ count: total })
}
