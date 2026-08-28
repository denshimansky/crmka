import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/api-permissions"
import { z } from "zod"
import { previewBulkRenew } from "@/lib/subscriptions/bulk-renew"

export const runtime = "nodejs"
export const maxDuration = 60

const schema = z.object({
  rangeStart: z.string().min(10),
  rangeEnd: z.string().min(10),
  branchId: z.string().uuid().nullable().optional(),
  directionId: z.string().uuid().nullable().optional(),
})

function parseDay(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  return d
}

export async function POST(req: NextRequest) {
  // Зеркалит гейт основного роута: право «Создание и редактирование
  // абонементов» вместо прежнего хардкода owner/manager.
  const guard = await requirePermission("subscriptions.edit")
  if (!guard.ok) return guard.response
  const user = guard.session!.user as {
    role: string
    tenantId: string
    allowedBranchIds: string[] | null
  }

  const json = await req.json().catch(() => null)
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  const rangeStart = parseDay(parsed.data.rangeStart)
  const rangeEnd = parseDay(parsed.data.rangeEnd)
  if (!rangeStart || !rangeEnd) {
    return NextResponse.json({ error: "Даты должны быть в формате YYYY-MM-DD" }, { status: 400 })
  }
  if (rangeStart > rangeEnd) {
    return NextResponse.json({ error: "Начало периода позже конца" }, { status: 400 })
  }
  // Зеркалит guard основного роута: выписка задним числом недоступна.
  const currentMonthStart = new Date()
  currentMonthStart.setDate(1)
  currentMonthStart.setHours(0, 0, 0, 0)
  if (rangeEnd < currentMonthStart) {
    return NextResponse.json(
      { error: "Период выписки уже прошёл — выписка задним числом недоступна" },
      { status: 400 },
    )
  }

  // ADM-04: предосмотр показывает ровно то, что выпишется, — только филиалы роли.
  const allowedBranchIds = user.allowedBranchIds ?? null
  const branchId = parsed.data.branchId ?? null
  if (branchId && allowedBranchIds && !allowedBranchIds.includes(branchId)) {
    return NextResponse.json({ error: "Нет доступа к этому филиалу" }, { status: 403 })
  }

  try {
    const preview = await previewBulkRenew({
      tenantId: user.tenantId,
      rangeStart,
      rangeEnd,
      branchId,
      directionId: parsed.data.directionId ?? null,
      allowedBranchIds,
    })
    return NextResponse.json(preview)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
