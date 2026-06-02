import { db } from "@/lib/db"
import { getNonWorkingDateSet } from "@/lib/production-calendar"

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function jsDayToTemplateDay(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1
}

export interface CountLessonsInput {
  tenantId: string
  groupId: string
  rangeStart: Date // inclusive
  rangeEnd: Date // inclusive
}

export interface CountLessonsResult {
  count: number
  hasSchedule: boolean
  skippedNonWorking: number
}

/**
 * Чистый подсчёт занятий группы за период по её GroupScheduleTemplate
 * с учётом нерабочих дней производственного календаря. Ничего не пишет
 * в БД — используется для preview массовой выписки.
 *
 * Логика дат идентична generateGroupLessons (см. generate-group-lessons.ts).
 * Шаблоны фильтруются по effectiveFrom/effectiveTo, чтобы не считать слоты,
 * которые в указанном диапазоне ещё/уже не действовали.
 */
export async function countLessonsForGroup(
  opts: CountLessonsInput,
): Promise<CountLessonsResult> {
  const { tenantId, groupId, rangeStart, rangeEnd } = opts

  const templates = await db.groupScheduleTemplate.findMany({
    where: {
      tenantId,
      groupId,
      effectiveFrom: { lte: rangeEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: rangeStart } }],
    },
    select: {
      dayOfWeek: true,
      startTime: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  })

  if (templates.length === 0) {
    return { count: 0, hasSchedule: false, skippedNonWorking: 0 }
  }

  const nonWorking = await getNonWorkingDateSet(tenantId, rangeStart, rangeEnd)
  const skipped = new Set<string>()

  const cursor = new Date(rangeStart)
  cursor.setHours(0, 0, 0, 0)
  const end = new Date(rangeEnd)
  end.setHours(0, 0, 0, 0)

  let count = 0
  while (cursor <= end) {
    const tDay = jsDayToTemplateDay(cursor.getDay())
    const dateStr = ymd(cursor)
    for (const t of templates) {
      if (t.dayOfWeek !== tDay) continue
      if (t.effectiveFrom > cursor) continue
      if (t.effectiveTo && t.effectiveTo < cursor) continue
      if (nonWorking.has(dateStr)) {
        skipped.add(dateStr)
        continue
      }
      count++
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  return { count, hasSchedule: true, skippedNonWorking: skipped.size }
}
