import { NextResponse } from "next/server"
import { getAdminSession } from "@/lib/admin-auth"
import { parseDialogRange, fetchDialogs, dialogStats, AI_REVIEW_PREVIEW } from "@/lib/ai-review"

// GET /api/admin/ai-review?from=YYYY-MM-DD&to=YYYY-MM-DD&onlyDisliked=1
// Превью диалогов ИИ за период + сводка. Доступно всем админ-ролям (чтение).
export async function GET(req: Request) {
  const admin = await getAdminSession()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const range = parseDialogRange(searchParams)
  const [dialogs, stats] = await Promise.all([
    fetchDialogs(range, AI_REVIEW_PREVIEW),
    dialogStats(range),
  ])

  // matched — число строк, попадающих под ТЕКУЩИЙ фильтр (с учётом onlyDisliked).
  // stats.total/likes/dislikes — разбивка по всему периоду (для сводки), поэтому
  // денайминатор усечения и доступность экспорта считаем по matched, а не по total.
  const matched = range.onlyDisliked ? stats.dislikes : stats.total

  return NextResponse.json({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    onlyDisliked: range.onlyDisliked,
    previewLimit: AI_REVIEW_PREVIEW,
    stats,
    matched,
    dialogs,
  })
}
