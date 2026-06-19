import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** 3.11. Продажи менеджеров по каналам — сводная «менеджер × канал» (баг #27). */
const UNKNOWN = "unknown"

export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange, searchParams } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange
  const mode = searchParams.get("mode") || "sales" // trials_scheduled | trials_attended | sales

  const employees = await db.employee.findMany({
    where: { tenantId, deletedAt: null, role: { in: ["admin", "manager", "owner"] } },
    select: { id: true, firstName: true, lastName: true },
  })
  const empMap = new Map(employees.map((e) => [e.id, [e.lastName, e.firstName].filter(Boolean).join(" ")]))

  // Имена каналов (включая выключенные — чтобы исторические ссылки резолвились).
  const channels = await db.leadChannel.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  })
  const channelName = new Map(channels.map((c) => [c.id, c.name]))

  // grid: empId -> channelKey -> count
  const grid: Record<string, Record<string, number>> = {}
  const add = (empId: string | null, channelId: string | null) => {
    const emp = empId || UNKNOWN
    const ch = channelId || UNKNOWN
    if (!grid[emp]) grid[emp] = {}
    grid[emp][ch] = (grid[emp][ch] || 0) + 1
  }

  if (mode === "trials_scheduled" || mode === "trials_attended") {
    const trialWhere: Prisma.TrialLessonWhereInput = { tenantId }
    if (mode === "trials_scheduled") {
      trialWhere.createdAt = { gte: dateFrom, lte: dateTo }
    } else {
      trialWhere.scheduledDate = { gte: dateFrom, lte: dateTo }
      trialWhere.status = "attended"
    }
    const trials = await db.trialLesson.findMany({
      where: trialWhere,
      select: { createdBy: true, client: { select: { channelId: true } } },
    })
    for (const t of trials) add(t.createdBy, t.client.channelId)
  } else {
    // Sales mode — клиент конвертировался (первая продажа) в периоде. «Дата продажи»
    // = COALESCE(saleDate, firstPaymentDate, firstPaidLessonDate), как в отчётах
    // оттока/дозвона: у импортированной базы saleDate часто пуст, и фильтр только
    // по нему занижал продажи (баг #27 follow-up, проверено на msk1: июнь 35→40).
    // OR-ветки взаимоисключающи и точно выражают «COALESCE(...) ∈ [from, to]».
    const inPeriod = { gte: dateFrom, lte: dateTo }
    const clients = await db.client.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { saleDate: inPeriod },
          { saleDate: null, firstPaymentDate: inPeriod },
          { saleDate: null, firstPaymentDate: null, firstPaidLessonDate: inPeriod },
        ],
      },
      select: { createdBy: true, channelId: true },
    })
    for (const c of clients) add(c.createdBy, c.channelId)
  }

  // Колонки-каналы — только встречающиеся в данных: именованные по алфавиту,
  // «Без канала» (unknown) — последним.
  const usedKeys = new Set<string>()
  for (const row of Object.values(grid)) for (const k of Object.keys(row)) usedKeys.add(k)
  const namedKeys = [...usedKeys]
    .filter((k) => k !== UNKNOWN)
    .sort((a, b) => (channelName.get(a) || "").localeCompare(channelName.get(b) || "", "ru"))
  const orderedKeys = usedKeys.has(UNKNOWN) ? [...namedKeys, UNKNOWN] : namedKeys
  const channelCols = orderedKeys.map((k) => ({
    id: k,
    name: k === UNKNOWN ? "Без канала" : channelName.get(k) || "—",
  }))

  const data = Object.entries(grid).map(([empId, byChannel]) => ({
    managerId: empId,
    managerName: empId === UNKNOWN ? "Не указан" : empMap.get(empId) || "Неизвестный",
    total: Object.values(byChannel).reduce((s, v) => s + v, 0),
    byChannel,
  }))

  return NextResponse.json({
    data,
    metadata: {
      mode,
      channels: channelCols,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    },
  })
}
