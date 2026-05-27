import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/lessons?date=YYYY-MM-DD[&excludeId=...][&branchId=...][&directionId=...]
 *
 * Возвращает занятия тенанта в указанную дату. Используется в модалке
 * «Назначена отработка» для выбора целевого занятия. Опциональные фильтры
 * `branchId` и `directionId` сужают список — модалка показывает только
 * занятия выбранных филиала/направления.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const url = new URL(req.url)
  const dateParam = url.searchParams.get("date")
  const excludeId = url.searchParams.get("excludeId")
  const branchId = url.searchParams.get("branchId")
  const directionId = url.searchParams.get("directionId")

  if (!dateParam) {
    return NextResponse.json({ error: "Параметр date обязателен (YYYY-MM-DD)" }, { status: 400 })
  }

  const date = new Date(dateParam)
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: "Некорректная дата" }, { status: 400 })
  }

  const groupFilter: Record<string, unknown> = {}
  if (branchId) groupFilter.branchId = branchId
  if (directionId) groupFilter.directionId = directionId

  const lessons = await db.lesson.findMany({
    where: {
      tenantId,
      date,
      status: { not: "cancelled" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...(Object.keys(groupFilter).length ? { group: { is: groupFilter } } : {}),
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      durationMinutes: true,
      group: {
        select: {
          name: true,
          direction: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
          room: { select: { name: true } },
        },
      },
      instructor: { select: { firstName: true, lastName: true } },
      substituteInstructor: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startTime: "asc" },
  })

  return NextResponse.json(lessons)
}
