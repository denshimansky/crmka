import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"
import { NON_CONSUMING_CODES } from "@/lib/subscriptions/consumed-lessons"

/** 5.14. Отсутствие учеников / потери выручки */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const branchId = searchParams.get("branchId")
  const directionId = searchParams.get("directionId")

  const attWhere: any = {
    tenantId,
    lesson: { date: { gte: dateFrom, lte: dateTo } },
  }
  if (branchId) attWhere.lesson = { ...attWhere.lesson, group: { branchId } }
  if (directionId) attWhere.subscription = { directionId }

  // Get all attendances with type info
  const attendances = await db.attendance.findMany({
    where: attWhere,
    select: {
      id: true,
      chargeAmount: true,
      clientId: true,
      attendanceType: {
        select: { code: true, chargesSubscription: true, partOfFact: true },
      },
      client: { select: { firstName: true, lastName: true } },
      subscription: { select: { type: true, direction: { select: { name: true } }, lessonPrice: true, discountPerLesson: true } },
    },
  })

  // Потери выручки = финальные несписывающие отметки (спека 5.14 «посещения без
  // списания»): Перерасчёт, Уваж. пропуск и кастомные несписывающие типы.
  // Промежуточные/технические статусы (Не был, отработки) — не потеря: списание
  // ещё впереди или происходит на реальной отработке. Раньше считался только
  // код "recalculation" — кастомные типы и УП выпадали из отчёта.
  // У пакетных абонементов несписывающая отметка занятие НЕ сжигает (см.
  // consumed-lessons.ts) — слот остаётся клиенту, выручка не потеряна.
  const recalculations = attendances.filter(
    (a) =>
      !a.attendanceType.chargesSubscription &&
      !NON_CONSUMING_CODES.includes(a.attendanceType.code) &&
      a.subscription?.type !== "package"
  )

  // «Со списанием при отсутствии»: тип списывает (chargesSubscription), но факта
  // посещения нет (partOfFact=false) — Прогул и кастомные списывающие пропуски.
  // Раньше считался только код "absent".
  const absencesCharged = attendances.filter(
    (a) =>
      a.attendanceType.chargesSubscription &&
      !a.attendanceType.partOfFact &&
      Number(a.chargeAmount) > 0
  )

  // Group by client
  const clientStats = new Map<
    string,
    {
      name: string
      direction: string
      recalcCount: number
      recalcAmount: number
      absenceCount: number
      absenceAmount: number
    }
  >()

  for (const a of recalculations) {
    const prev = clientStats.get(a.clientId) || {
      name: [a.client.lastName, a.client.firstName].filter(Boolean).join(" ") || "Без имени",
      direction: a.subscription?.direction?.name || "—",
      recalcCount: 0,
      recalcAmount: 0,
      absenceCount: 0,
      absenceAmount: 0,
    }
    prev.recalcCount += 1
    // Скидки v2: потери считаем по эффективной цене занятия.
    prev.recalcAmount += Math.max(
      0,
      Number(a.subscription?.lessonPrice || 0) - Number(a.subscription?.discountPerLesson || 0),
    )
    clientStats.set(a.clientId, prev)
  }

  for (const a of absencesCharged) {
    const prev = clientStats.get(a.clientId) || {
      name: [a.client.lastName, a.client.firstName].filter(Boolean).join(" ") || "Без имени",
      direction: a.subscription?.direction?.name || "—",
      recalcCount: 0,
      recalcAmount: 0,
      absenceCount: 0,
      absenceAmount: 0,
    }
    prev.absenceCount += 1
    prev.absenceAmount += Number(a.chargeAmount)
    clientStats.set(a.clientId, prev)
  }

  const data = [...clientStats.entries()]
    .map(([clientId, v]) => ({ clientId, ...v }))
    .sort((a, b) => b.recalcAmount - a.recalcAmount)

  return NextResponse.json({
    data,
    metadata: {
      totalRecalculations: recalculations.length,
      totalRecalcAmount: data.reduce((s, d) => s + d.recalcAmount, 0),
      totalAbsences: absencesCharged.length,
      totalAbsenceAmount: data.reduce((s, d) => s + d.absenceAmount, 0),
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
