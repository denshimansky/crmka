import { db } from "@/lib/db"
import { buildCellRevenue, type CellRevenue } from "./pnl-allocation"

/**
 * Веса аллокации ОПИУ: выручка ячеек (филиал, направление) за окно отчёта, по ВСЕЙ сети
 * (без фильтра филиала). Нужна для срезов филиалов — доля общего/мультифилиального расхода
 * или прочего дохода считается относительно всей сети (см. lib/pnl-allocation). Тянуть
 * лениво, только когда строится срез филиала (без филиала аллокация не сужает).
 */
export async function fetchCellRevenue(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<CellRevenue> {
  const atts = await db.attendance.findMany({
    where: {
      tenantId,
      lesson: { date: { gte: dateFrom, lte: dateTo } },
      attendanceType: { countsAsRevenue: true },
    },
    select: { chargeAmount: true, lesson: { select: { group: { select: { branchId: true, directionId: true } } } } },
  })
  return buildCellRevenue(
    atts.map((a) => ({ branchId: a.lesson.group.branchId, directionId: a.lesson.group.directionId, amount: Number(a.chargeAmount) })),
  )
}
