import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/lessons/[id]/add-student/search?q=...
 *
 * Поиск любых детей (с привязкой к Client) для добавления на занятие.
 * Возвращает список ward-ов с информацией о родителе (баланс) и об активном
 * абонементе на группу этого занятия (если есть).
 *
 * Отличие от /makeup/search: тут не отсекаем детей без абонемента — для них
 * доступен вариант «баланс родителя» / разовое посещение.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = session.user.tenantId

  const url = new URL(req.url)
  const q = url.searchParams.get("q")?.trim() || ""
  if (q.length < 2) return NextResponse.json([])

  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: { id: true, groupId: true, date: true },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  const lessonDate = new Date(lesson.date)
  const periodYear = lessonDate.getFullYear()
  const periodMonth = lessonDate.getMonth() + 1

  const searchTerms = q.split(/\s+/).filter(Boolean)

  const clients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      AND: searchTerms.map((term) => ({
        OR: [
          { firstName: { contains: term, mode: "insensitive" as const } },
          { lastName: { contains: term, mode: "insensitive" as const } },
          { phone: { contains: term } },
          { wards: { some: { firstName: { contains: term, mode: "insensitive" as const } } } },
          { wards: { some: { lastName: { contains: term, mode: "insensitive" as const } } } },
        ],
      })),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      clientBalance: true,
      wards: { select: { id: true, firstName: true, lastName: true } },
      subscriptions: {
        where: {
          deletedAt: null,
          status: { in: ["active", "pending"] },
          groupId: lesson.groupId,
          periodYear,
          periodMonth,
        },
        select: { id: true, wardId: true, balance: true, lessonPrice: true },
      },
    },
    take: 30,
  })

  // Уже на занятии — исключаем
  const existingAttendances = await db.attendance.findMany({
    where: { lessonId, tenantId },
    select: { clientId: true, wardId: true },
  })
  const attendingKeys = new Set(
    existingAttendances.map((a) => `${a.clientId}:${a.wardId || ""}`),
  )

  const results: Array<{
    clientId: string
    clientName: string
    clientPhone: string | null
    clientBalance: number
    wardId: string | null
    wardName: string
    subscription: { id: string; balance: number; lessonPrice: number } | null
  }> = []

  for (const c of clients) {
    const clientName = [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
    const wards = c.wards.length > 0 ? c.wards : [null]
    for (const w of wards) {
      const key = `${c.id}:${w?.id || ""}`
      if (attendingKeys.has(key)) continue
      const sub = c.subscriptions.find((s) => s.wardId === (w?.id || null))
      results.push({
        clientId: c.id,
        clientName,
        clientPhone: c.phone,
        clientBalance: Number(c.clientBalance),
        wardId: w?.id || null,
        wardName: w
          ? [w.lastName, w.firstName].filter(Boolean).join(" ") || "Без имени"
          : clientName,
        subscription:
          sub && Number(sub.balance) > 0
            ? { id: sub.id, balance: Number(sub.balance), lessonPrice: Number(sub.lessonPrice) }
            : null,
      })
    }
  }

  return NextResponse.json(results.slice(0, 30))
}
