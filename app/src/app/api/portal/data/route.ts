import { NextResponse } from "next/server"
import { getPortalSession } from "@/lib/portal-auth"
import { db } from "@/lib/db"

// GET /api/portal/data — все данные клиента для ЛК
export async function GET() {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!session.pdnConsent) return NextResponse.json({ error: "Требуется согласие на обработку ПДн" }, { status: 403 })

  const { clientId, tenantId } = session

  // Клиент
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      patronymic: true,
      phone: true,
      email: true,
      clientBalance: true,
    },
  })
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  // Подопечные
  const wards = await db.ward.findMany({
    where: { clientId, tenantId },
    select: { id: true, firstName: true, lastName: true, birthDate: true },
  })

  // Активные абонементы
  const subscriptions = await db.subscription.findMany({
    where: { clientId, tenantId, deletedAt: null, status: { in: ["active", "pending"] } },
    include: {
      direction: { select: { name: true, color: true } },
      group: { select: { name: true } },
      ward: { select: { firstName: true, lastName: true } },
    },
    orderBy: { startDate: "desc" },
  })

  // История абонементов (закрытые)
  const subscriptionHistory = await db.subscription.findMany({
    where: { clientId, tenantId, deletedAt: null, status: { in: ["closed", "withdrawn"] } },
    include: {
      direction: { select: { name: true } },
      group: { select: { name: true } },
    },
    orderBy: { startDate: "desc" },
    take: 10,
  })

  // Оплаты
  const payments = await db.payment.findMany({
    where: { clientId, tenantId, deletedAt: null },
    include: {
      subscription: { select: { direction: { select: { name: true } } } },
    },
    orderBy: { date: "desc" },
    take: 20,
  })

  // Расписание: ближайшие занятия (через зачисления)
  const now = new Date()
  const weekLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  const enrollments = await db.groupEnrollment.findMany({
    where: { clientId, tenantId, isActive: true, deletedAt: null },
    select: { groupId: true, ward: { select: { firstName: true } } },
  })

  const groupIds = enrollments.map((e) => e.groupId)

  const lessons = groupIds.length > 0
    ? await db.lesson.findMany({
        where: {
          tenantId,
          groupId: { in: groupIds },
          date: { gte: now, lte: weekLater },
          status: "scheduled",
        },
        include: {
          group: {
            select: { name: true, direction: { select: { name: true, color: true } } },
          },
          instructor: { select: { firstName: true, lastName: true } },
        },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      })
    : []

  return NextResponse.json({
    client,
    wards,
    subscriptions,
    subscriptionHistory,
    payments,
    schedule: lessons,
  })
}
