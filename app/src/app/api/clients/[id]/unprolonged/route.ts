import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { findNotRenewedSubscriptions } from "@/lib/reports/not-renewed"

// Непродлённые абонементы клиента для карточки (баг #49 / «Непродлённые абонементы»).
// «Текущий месяц» = текущий календарный; M−1 — прошлый. Логика — единый хелпер
// findNotRenewedSubscriptions (как в отчёте reports/not-renewed).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  // Клиент должен принадлежать арендатору (RLS на проде не enforced).
  const client = await db.client.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { subscriptionType: true },
  })
  const isPackage = org?.subscriptionType === "package"

  const now = new Date()
  const { prevYear, prevMonth, notRenewed } = await findNotRenewedSubscriptions(db, tenantId, {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    isPackage,
    clientId: id,
  })

  const subscriptions = notRenewed.map((s) => ({
    id: s.id,
    directionName: s.direction.name,
    groupName: s.group.name,
    periodMonth: s.periodMonth ?? prevMonth,
    periodYear: s.periodYear ?? prevYear,
  }))

  // Комментарии по этим непродлённым абонементам.
  const subIds = notRenewed.map((s) => s.id)
  const commentRows = subIds.length > 0
    ? await db.unprolongedComment.findMany({
        where: { tenantId, clientId: id, subscriptionId: { in: subIds } },
        select: {
          id: true,
          subscriptionId: true,
          comment: true,
          createdAt: true,
          creator: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "desc" },
      })
    : []

  const comments = commentRows.map((c) => ({
    id: c.id,
    subscriptionId: c.subscriptionId,
    comment: c.comment,
    authorName:
      [c.creator?.lastName, c.creator?.firstName].filter(Boolean).join(" ") || "—",
    createdAt: c.createdAt.toISOString(),
  }))

  return NextResponse.json({ subscriptions, comments })
}
