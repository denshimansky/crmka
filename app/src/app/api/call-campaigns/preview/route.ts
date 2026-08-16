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
import { loadNoAnswerDesiredRows } from "@/lib/call-campaigns/no-answer-source"
import { branchScopeFromSession } from "@/lib/branch-scope"

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

  const allowedBranchIds =
    (session.user as { allowedBranchIds?: string[] | null }).allowedBranchIds ?? null

  // «Обзвон по не ответившим»: размер = число строк-подопечных из no_answer-позиций
  // других кампаний в scope (тот же источник, что при создании).
  if (parsed.data.mode === "no_answer") {
    const scope = branchScopeFromSession(allowedBranchIds)
    const desired = await loadNoAnswerDesiredRows(db, session.user.tenantId, scope)
    let count = 0
    for (const wards of desired.values()) count += wards.size
    return NextResponse.json({ count })
  }

  const where = buildScopedCampaignWhere(session.user.tenantId, allowedBranchIds, parsed.data)

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
