import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const copySchema = z.object({
  sourceYear: z.number().int().min(2020),
  sourceMonth: z.number().int().min(1).max(12),
  targetYear: z.number().int().min(2020),
  targetMonth: z.number().int().min(1).max(12),
})

// POST /api/planned-expenses/copy-month
// Копирует ВСЕ плановые расходы исходного месяца в целевой. В отличие от
// фактических расходов, у плановых нет флага «повторяющийся» — план задают
// помесячно, поэтому копируется всё. Дубликаты (та же категория + филиал
// + период) пропускаются, чтобы повторный запуск не порождал дублей.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = copySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Ошибка валидации" },
      { status: 400 }
    )
  }
  const { sourceYear, sourceMonth, targetYear, targetMonth } = parsed.data
  const tenantId = session.user.tenantId

  const sourceItems = await db.plannedExpense.findMany({
    where: { tenantId, periodYear: sourceYear, periodMonth: sourceMonth },
  })
  if (sourceItems.length === 0) {
    return NextResponse.json(
      { error: "В исходном месяце нет плановых расходов" },
      { status: 400 }
    )
  }

  // Уже существующие в целевом периоде (категория + branch + employee) —
  // чтобы не плодить дубликаты при повторном нажатии.
  const existing = await db.plannedExpense.findMany({
    where: { tenantId, periodYear: targetYear, periodMonth: targetMonth },
    select: { categoryId: true, branchId: true, employeeId: true },
  })
  const existingKey = new Set(
    existing.map((e) => `${e.categoryId}|${e.branchId ?? ""}|${e.employeeId ?? ""}`),
  )

  const toCreate = sourceItems.filter(
    (s) => !existingKey.has(`${s.categoryId}|${s.branchId ?? ""}|${s.employeeId ?? ""}`),
  )

  if (toCreate.length === 0) {
    return NextResponse.json(
      { error: "Все плановые расходы из исходного месяца уже есть в целевом" },
      { status: 400 }
    )
  }

  const created = await db.$transaction(
    toCreate.map((s) =>
      db.plannedExpense.create({
        data: {
          tenantId,
          categoryId: s.categoryId,
          employeeId: s.employeeId,
          branchId: s.branchId,
          periodYear: targetYear,
          periodMonth: targetMonth,
          plannedAmount: s.plannedAmount,
          comment: s.comment,
        },
      }),
    ),
  )

  return NextResponse.json(
    { copied: created.length, skipped: sourceItems.length - created.length },
    { status: 201 },
  )
}
