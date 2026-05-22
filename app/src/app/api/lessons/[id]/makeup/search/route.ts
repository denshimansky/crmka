import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/lessons/[id]/makeup/search?q=...
 *
 * Поиск клиентов с активными абонементами для добавления их подопечного на
 * отработку. После выбора клиента/подопечного, конкретное оригинальное занятие
 * выбирается отдельно через /api/clients/[id]/makeup-eligible-lessons.
 *
 * Возвращает по одной строке на каждого подопечного (ward) с активным
 * абонементом, чтобы UI мог сразу показать «Ваня (родитель Петров) — английский».
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = session.user.tenantId

  const url = new URL(req.url)
  const q = url.searchParams.get("q")?.trim() || ""

  if (q.length < 2) return NextResponse.json([])

  // Verify lesson exists
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: { id: true },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  const searchTerms = q.split(/\s+/).filter(Boolean)

  // Ищем по ФИО клиента (родителя) и подопечного.
  const clients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      AND: searchTerms.map((term) => ({
        OR: [
          { firstName: { contains: term, mode: "insensitive" as const } },
          { lastName: { contains: term, mode: "insensitive" as const } },
          { wards: { some: { firstName: { contains: term, mode: "insensitive" as const } } } },
          { wards: { some: { lastName: { contains: term, mode: "insensitive" as const } } } },
        ],
      })),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      wards: {
        select: { id: true, firstName: true, lastName: true },
      },
      subscriptions: {
        where: { deletedAt: null, status: { in: ["active", "pending"] } },
        select: { id: true, wardId: true, groupId: true },
      },
    },
    take: 30,
  })

  // Уже отмеченные на этом занятии — исключаем
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
    wardId: string
    wardName: string
    activeSubscriptionsCount: number
  }> = []

  for (const c of clients) {
    const clientName =
      [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
    for (const w of c.wards) {
      const key = `${c.id}:${w.id}`
      if (attendingKeys.has(key)) continue
      const wardSubs = c.subscriptions.filter((s) => s.wardId === w.id)
      if (wardSubs.length === 0) continue
      results.push({
        clientId: c.id,
        clientName,
        wardId: w.id,
        wardName: [w.lastName, w.firstName].filter(Boolean).join(" ") || "Без имени",
        activeSubscriptionsCount: wardSubs.length,
      })
    }
  }

  return NextResponse.json(results.slice(0, 20))
}
