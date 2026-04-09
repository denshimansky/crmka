import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const copySchema = z.object({
  sourceMonth: z.string().regex(/^\d{4}-\d{2}$/, "Формат: YYYY-MM"),
  targetMonth: z.string().regex(/^\d{4}-\d{2}$/, "Формат: YYYY-MM"),
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId

  const body = await req.json()
  const parsed = copySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const { sourceMonth, targetMonth } = parsed.data
  if (sourceMonth === targetMonth) {
    return NextResponse.json({ error: "Исходный и целевой месяц совпадают" }, { status: 400 })
  }

  const [sourceYear, sourceM] = sourceMonth.split("-").map(Number)
  const [targetYear, targetM] = targetMonth.split("-").map(Number)

  const sourceStart = new Date(sourceYear, sourceM - 1, 1)
  const sourceEnd = new Date(sourceYear, sourceM, 0) // last day of source month
  sourceEnd.setHours(23, 59, 59, 999)

  // Fetch all non-cancelled lessons in source month
  const sourceLessons = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: sourceStart, lte: sourceEnd },
      status: { not: "cancelled" },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  })

  if (sourceLessons.length === 0) {
    return NextResponse.json({ error: "Нет занятий в исходном месяце" }, { status: 400 })
  }

  // Fetch existing lessons in target month to avoid duplicates
  const targetStart = new Date(targetYear, targetM - 1, 1)
  const targetEnd = new Date(targetYear, targetM, 0)
  targetEnd.setHours(23, 59, 59, 999)

  const existingLessons = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: targetStart, lte: targetEnd },
      status: { not: "cancelled" },
    },
    select: { groupId: true, date: true, startTime: true },
  })

  // Build a set of existing "groupId|date|startTime" for dedup
  const existingSet = new Set(
    existingLessons.map(
      (l) => `${l.groupId}|${l.date.toISOString().slice(0, 10)}|${l.startTime}`
    )
  )

  // Calculate month offset for date shifting
  const monthDiff = (targetYear - sourceYear) * 12 + (targetM - sourceM)
  const lastDayOfTarget = new Date(targetYear, targetM, 0).getDate()

  const lessonsToCreate: Array<{
    tenantId: string
    groupId: string
    date: Date
    startTime: string
    durationMinutes: number
    instructorId: string
    isTrial: boolean
    status: "scheduled"
    isMakeup: boolean
  }> = []

  for (const lesson of sourceLessons) {
    // Shift date by month difference, clamping day to target month bounds
    const srcDate = lesson.date
    const srcDay = srcDate.getDate()
    const newDay = Math.min(srcDay, lastDayOfTarget)
    const newDate = new Date(targetYear, targetM - 1, newDay)

    const dateStr = newDate.toISOString().slice(0, 10)
    const key = `${lesson.groupId}|${dateStr}|${lesson.startTime}`

    if (existingSet.has(key)) continue

    existingSet.add(key) // prevent duplicates within same batch

    lessonsToCreate.push({
      tenantId,
      groupId: lesson.groupId,
      date: newDate,
      startTime: lesson.startTime,
      durationMinutes: lesson.durationMinutes,
      instructorId: lesson.instructorId,
      isTrial: false,
      status: "scheduled",
      isMakeup: false,
    })
  }

  if (lessonsToCreate.length === 0) {
    return NextResponse.json({ error: "Все занятия уже существуют в целевом месяце" }, { status: 400 })
  }

  const result = await db.lesson.createMany({
    data: lessonsToCreate,
  })

  return NextResponse.json({ created: result.count }, { status: 201 })
}
