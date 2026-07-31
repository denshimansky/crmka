import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

// GET /api/salary-rates/[id]/schedule/impact?from=YYYY-MM-DD
// Счётчик будущих занятий инструктора (по этой ставке), которые пересчитаются.
// Приблизительный: не учитывает перекрытие GroupSalaryRate группы.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  const from = new URL(req.url).searchParams.get("from")
  if (!from) return NextResponse.json({ error: "Параметр from обязателен" }, { status: 400 })
  const fromDate = new Date(from)
  if (Number.isNaN(fromDate.getTime())) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 })
  }

  const rate = await db.salaryRate.findFirst({
    where: { id, tenantId },
    select: { employeeId: true, directionId: true },
  })
  if (!rate) return NextResponse.json({ error: "Ставка не найдена" }, { status: 404 })

  const count = await db.lesson.count({
    where: {
      tenantId,
      date: { gte: fromDate },
      status: { in: ["scheduled", "completed"] },
      isTrial: false,
      OR: [{ instructorId: rate.employeeId }, { substituteInstructorId: rate.employeeId }],
      ...(rate.directionId ? { group: { directionId: rate.directionId } } : {}),
    },
  })

  return NextResponse.json({ count })
}
