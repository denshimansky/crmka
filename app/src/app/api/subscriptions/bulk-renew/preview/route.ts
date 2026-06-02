import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
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
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Только владелец или управляющий" }, { status: 403 })
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

  try {
    const preview = await previewBulkRenew({
      tenantId: session.user.tenantId,
      rangeStart,
      rangeEnd,
      branchId: parsed.data.branchId ?? null,
      directionId: parsed.data.directionId ?? null,
    })
    return NextResponse.json(preview)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
