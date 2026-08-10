import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getReportContext } from "@/lib/report-helpers"

/** Один исход обзвона в разрезе (менеджер × день). */
interface DayCell {
  total: number
  application: number
  completed: number
  callback: number
  noAnswer: number
}

function emptyCell(): DayCell {
  return { total: 0, application: 0, completed: 0, callback: 0, noAnswer: 0 }
}

const MSK_TZ = "Europe/Moscow"
/** Дата фиксации результата → «YYYY-MM-DD» по московскому времени. */
function mskDay(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: MSK_TZ })
}

/**
 * 3.10 (вкладка 2). Эффективность обзвонов по менеджерам.
 *
 * Матрица: строки — менеджеры (кто зафиксировал результат, CallCampaignItem.calledBy),
 * столбцы — дни выбранного месяца (по московскому времени). В каждой ячейке — всего
 * обзвонено за день и разбивка по исходам (заявка / отказ / перезвонить / не ответил).
 *
 * Учитывается ПОСЛЕДНИЙ зафиксированный результат по контакту (модель хранит только
 * его: calledAt/calledBy/status перезаписываются при повторной отметке).
 */
export async function GET(req: NextRequest) {
  const result = await getReportContext(req)
  if (result.error) return result.error
  const { session, dateRange } = result.ctx
  const { tenantId } = session
  const { dateFrom, dateTo } = dateRange

  // Целевой месяц берём из dateFrom (MonthPicker кладёт UTC-полночь 1-го числа).
  const ym = `${dateFrom.getUTCFullYear()}-${String(dateFrom.getUTCMonth() + 1).padStart(2, "0")}`

  // Окно запроса расширяем на ±1 день: звонок 1-го числа 00:30 MSK — это 31-е
  // предыдущего месяца по UTC, и наоборот. Лишнее отфильтруем по MSK-месяцу ниже.
  const DAY_MS = 24 * 60 * 60 * 1000
  const from = new Date(dateFrom.getTime() - DAY_MS)
  const to = new Date(dateTo.getTime() + DAY_MS)

  const items = await db.callCampaignItem.findMany({
    where: {
      tenantId,
      status: { not: "pending" },
      calledAt: { gte: from, lte: to },
      // Удалённые кампании в статистику не берём (закрытые/архивные — берём: это
      // исторические, но реальные звонки).
      campaign: { deletedAt: null },
    },
    select: { calledBy: true, calledAt: true, status: true, result: true },
  })

  // Имена менеджеров (кто фиксировал результат).
  const managerIds = [...new Set(items.map((i) => i.calledBy).filter((v): v is string => !!v))]
  const employees = managerIds.length
    ? await db.employee.findMany({
        where: { id: { in: managerIds }, tenantId },
        select: { id: true, firstName: true, lastName: true },
      })
    : []
  const nameById = new Map(
    employees.map((e) => [e.id, [e.lastName, e.firstName].filter(Boolean).join(" ").trim() || "—"]),
  )

  const NONE = "none"
  const dayActivity = new Set<string>()
  const managers = new Map<
    string,
    { employeeId: string; name: string; byDay: Record<string, DayCell>; totals: DayCell }
  >()

  for (const it of items) {
    if (!it.calledAt) continue
    const day = mskDay(it.calledAt)
    if (day.slice(0, 7) !== ym) continue // отбрасываем «хвосты» соседних месяцев
    dayActivity.add(day)

    const key = it.calledBy ?? NONE
    let m = managers.get(key)
    if (!m) {
      m = {
        employeeId: key,
        name: it.calledBy ? (nameById.get(it.calledBy) ?? "—") : "Не указан",
        byDay: {},
        totals: emptyCell(),
      }
      managers.set(key, m)
    }
    const cell = (m.byDay[day] ??= emptyCell())

    cell.total++
    m.totals.total++
    // Заявка (result="application") имеет статус "called" — считаем её отдельно;
    // прочие исходы — по статусу. Порядок веток задаёт приоритет «заявки».
    if (it.result === "application") {
      cell.application++
      m.totals.application++
    } else if (it.status === "completed") {
      cell.completed++
      m.totals.completed++
    } else if (it.status === "callback") {
      cell.callback++
      m.totals.callback++
    } else if (it.status === "no_answer") {
      cell.noAnswer++
      m.totals.noAnswer++
    }
  }

  const days = [...dayActivity].sort()
  const managerList = [...managers.values()].sort((a, b) => {
    // «Не указан» — в конец, остальные по алфавиту.
    if (a.employeeId === NONE) return 1
    if (b.employeeId === NONE) return -1
    return a.name.localeCompare(b.name, "ru")
  })

  return NextResponse.json({
    data: { days, managers: managerList },
    metadata: {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      managers: managerList.length,
    },
  })
}
