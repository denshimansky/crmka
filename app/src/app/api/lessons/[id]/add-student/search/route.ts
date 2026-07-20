import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  effectiveRosterDate,
  rosterWhereOnDate,
  coverageSubscriptionsWhere,
  coverageSubscriptionSelect,
  coverageKeysOnDate,
  coverageKey,
} from "@/lib/subscriptions/roster-filter"

/**
 * GET /api/lessons/[id]/add-student/search?q=...
 *
 * Поиск детей (Ward) с привязкой к клиенту для добавления на занятие.
 * Возвращает список ward-ов с информацией о родителе (баланс) и об активном
 * абонементе на группу этого занятия (если есть).
 *
 * Поиск идёт по ФИО/телефону родителя ИЛИ по ФИО ребёнка — но в результатах
 * всегда конкретный ребёнок. Клиенты без подопечных в выдачу не попадают:
 * на занятие может быть добавлен только ребёнок, родитель самостоятельно — нет.
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
    select: {
      id: true,
      groupId: true,
      date: true,
      rescheduledFromDate: true,
      group: { select: { directionId: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: "Занятие не найдено" }, { status: 404 })

  // Дата состава: для перенесённого занятия — исходная (rescheduledFromDate),
  // иначе фактическая. По ней считаем период абонемента и покрытие — как в
  // page.tsx, чтобы поиск и состав занятия не расходились.
  const rosterDate = effectiveRosterDate(lesson)
  const periodYear = rosterDate.getFullYear()
  const periodMonth = rosterDate.getMonth() + 1

  const searchTerms = q.split(/\s+/).filter(Boolean)

  const clients = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      // На занятие можно добавить только ребёнка — клиенты без подопечных не возвращаются.
      wards: { some: {} },
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
        select: { id: true, wardId: true, balance: true, lessonPrice: true, discountPerLesson: true, startDate: true },
      },
    },
    take: 30,
  })

  // Исключаем тех, кто УЖЕ фактически в этом занятии — ровно как их показывает
  // страница занятия (page.tsx). Это:
  //  1) любые Attendance на занятии (вкл. placeholder разовых и pending);
  //  2) зачисления, активные на дату состава (rosterWhereOnDate) И ПОКРЫТЫЕ
  //     абонементом на эту дату (coverageKeysOnDate).
  // Зачисление БЕЗ покрытия на эту дату (например, абонемент начинается позже
  // даты состава) НЕ исключается: такого ребёнка нет в составе занятия, и его
  // правомерно добавить разовым посещением. Раньше отсекали по самому факту
  // активного зачисления — и зачисленный, но ещё не покрытый ребёнок проваливался
  // в щель: невидим в составе и недоступен в разовом.
  const [existingAttendances, enrollmentsOnDate, coverageSubs] = await Promise.all([
    db.attendance.findMany({
      where: { lessonId, tenantId },
      select: { clientId: true, wardId: true },
    }),
    db.groupEnrollment.findMany({
      where: {
        groupId: lesson.groupId,
        tenantId,
        deletedAt: null,
        ...rosterWhereOnDate(rosterDate),
      },
      select: { clientId: true, wardId: true },
    }),
    db.subscription.findMany({
      where: coverageSubscriptionsWhere({
        tenantId,
        directionIds: [lesson.group.directionId],
        from: rosterDate,
      }),
      select: coverageSubscriptionSelect,
    }),
  ])
  const coveredKeys = coverageKeysOnDate(coverageSubs, rosterDate)
  // Состав занятия = зачислён на дату И покрыт абонементом на дату (как в page.tsx).
  const rosterKeys = enrollmentsOnDate
    .map((e) => coverageKey(e.clientId, e.wardId))
    .filter((k) => coveredKeys.has(k))
  const attendingKeys = new Set<string>([
    ...existingAttendances.map((a) => coverageKey(a.clientId, a.wardId)),
    ...rosterKeys,
  ])

  const results: Array<{
    clientId: string
    clientName: string
    clientPhone: string | null
    clientBalance: number
    wardId: string
    wardName: string
    subscription: { id: string; balance: number; lessonPrice: number } | null
  }> = []

  for (const c of clients) {
    const clientName = [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
    for (const w of c.wards) {
      const key = coverageKey(c.id, w.id)
      if (attendingKeys.has(key)) continue
      const sub = c.subscriptions.find((s) => s.wardId === w.id)
      // Абонемент показываем только если он ПОКРЫВАЕТ дату занятия (startDate <=
      // дата состава). Иначе на этом занятии ребёнок разовый — списание с баланса
      // родителя, а не с этого абонемента; чип «Абонемент» вводил бы в заблуждение.
      const subCovers = sub ? sub.startDate <= rosterDate : false
      results.push({
        clientId: c.id,
        clientName,
        clientPhone: c.phone,
        clientBalance: Number(c.clientBalance),
        wardId: w.id,
        wardName: [w.lastName, w.firstName].filter(Boolean).join(" ") || "Без имени",
        subscription:
          sub && subCovers && Number(sub.balance) > 0
            ? {
                id: sub.id,
                balance: Number(sub.balance),
                // Скидки v2: показываем эффективную цену занятия.
                lessonPrice: Math.max(
                  0,
                  Number(sub.lessonPrice) - Number(sub.discountPerLesson ?? 0),
                ),
              }
            : null,
      })
    }
  }

  return NextResponse.json(results.slice(0, 30))
}
