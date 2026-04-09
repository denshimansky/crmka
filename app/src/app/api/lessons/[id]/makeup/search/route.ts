import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

/**
 * GET /api/lessons/[id]/makeup/search?q=...&groupId=...
 * Поиск учеников из других групп для отработки.
 * Возвращает клиентов с активными абонементами (не из текущей группы).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: lessonId } = await params
  const tenantId = (session.user as any).tenantId

  const url = new URL(req.url)
  const q = url.searchParams.get("q")?.trim() || ""
  const groupId = url.searchParams.get("groupId") || ""

  if (q.length < 2) {
    return NextResponse.json([])
  }

  // Verify lesson exists
  const lesson = await db.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: { id: true, date: true, groupId: true },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  const currentGroupId = groupId || lesson.groupId

  // Search clients by name (not enrolled in the current group)
  const searchTerms = q.split(/\s+/).filter(Boolean)
  const searchConditions = searchTerms.map(term => ({
    OR: [
      { firstName: { contains: term, mode: "insensitive" as const } },
      { lastName: { contains: term, mode: "insensitive" as const } },
    ],
  }))

  const clients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      AND: searchConditions,
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      wards: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
    take: 20,
  })

  if (clients.length === 0) return NextResponse.json([])

  const clientIds = clients.map(c => c.id)

  // Get active subscriptions for these clients (from OTHER groups, not current)
  const subscriptions = await db.subscription.findMany({
    where: {
      tenantId,
      clientId: { in: clientIds },
      groupId: { not: currentGroupId },
      deletedAt: null,
      status: { in: ["active", "pending"] },
      balance: { gt: 0 },
    },
    include: {
      group: {
        select: { name: true, direction: { select: { name: true } } },
      },
    },
  })

  // Already attending this lesson
  const existingAttendances = await db.attendance.findMany({
    where: { lessonId, tenantId },
    select: { clientId: true, wardId: true },
  })
  const attendingKeys = new Set(
    existingAttendances.map(a => `${a.clientId}:${a.wardId || ""}`)
  )

  // Build results
  const results: Array<{
    clientId: string
    clientName: string
    wardId: string | null
    wardName: string | null
    subscriptionId: string
    subscriptionLabel: string
    balance: number
    lessonPrice: number
  }> = []

  for (const sub of subscriptions) {
    const client = clients.find(c => c.id === sub.clientId)
    if (!client) continue

    const wardId = sub.wardId
    const key = `${sub.clientId}:${wardId || ""}`
    if (attendingKeys.has(key)) continue

    const ward = wardId ? client.wards.find(w => w.id === wardId) : null
    const clientName = [client.lastName, client.firstName].filter(Boolean).join(" ") || "Без имени"
    const wardName = ward ? [ward.lastName, ward.firstName].filter(Boolean).join(" ") : null

    results.push({
      clientId: sub.clientId,
      clientName,
      wardId: wardId,
      wardName,
      subscriptionId: sub.id,
      subscriptionLabel: `${sub.group.direction.name} — ${sub.group.name}`,
      balance: Number(sub.balance),
      lessonPrice: Number(sub.lessonPrice),
    })
  }

  return NextResponse.json(results.slice(0, 15))
}
