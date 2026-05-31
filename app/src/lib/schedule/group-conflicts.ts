import { db } from "@/lib/db"

export interface ScheduleSlot {
  dayOfWeek: number
  startTime: string
  durationMinutes: number
}

export interface SlotConflict {
  slot: ScheduleSlot
  with: Array<{
    groupId: string
    groupName: string
    startTime: string
    durationMinutes: number
  }>
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

function intervalsOverlap(
  aStart: number,
  aDuration: number,
  bStart: number,
  bDuration: number,
): boolean {
  return aStart < bStart + bDuration && bStart < aStart + aDuration
}

/**
 * Ищет пересечения новых шаблонов с существующими шаблонами других групп
 * в том же кабинете (по дню недели и времени).
 *
 * Не учитывает разовые занятия (isOneTime) и удалённые группы.
 */
export async function findRoomScheduleConflicts(params: {
  tenantId: string
  roomId: string
  templates: ScheduleSlot[]
  excludeGroupId?: string
}): Promise<SlotConflict[]> {
  const { tenantId, roomId, templates, excludeGroupId } = params

  if (templates.length === 0) return []

  const existing = await db.groupScheduleTemplate.findMany({
    where: {
      tenantId,
      group: {
        roomId,
        deletedAt: null,
        isOneTime: false,
        ...(excludeGroupId ? { id: { not: excludeGroupId } } : {}),
      },
    },
    select: {
      dayOfWeek: true,
      startTime: true,
      durationMinutes: true,
      group: { select: { id: true, name: true } },
    },
  })

  const result: SlotConflict[] = []

  for (const slot of templates) {
    const slotStart = toMinutes(slot.startTime)
    const matches = existing
      .filter((e) => e.dayOfWeek === slot.dayOfWeek)
      .filter((e) =>
        intervalsOverlap(
          slotStart,
          slot.durationMinutes,
          toMinutes(e.startTime),
          e.durationMinutes,
        ),
      )

    if (matches.length === 0) continue

    result.push({
      slot,
      with: matches.map((m) => ({
        groupId: m.group.id,
        groupName: m.group.name,
        startTime: m.startTime,
        durationMinutes: m.durationMinutes,
      })),
    })
  }

  return result
}

/**
 * Возвращает индексы дубликатов (одинаковая пара день недели + время начала)
 * среди новых шаблонов. Дубликат — это второй (и далее) повтор.
 */
export function findDuplicateTemplateIndexes(
  templates: Pick<ScheduleSlot, "dayOfWeek" | "startTime">[],
): number[] {
  const seen = new Map<string, number>()
  const dups: number[] = []
  templates.forEach((t, i) => {
    const key = `${t.dayOfWeek}_${t.startTime}`
    if (seen.has(key)) {
      dups.push(i)
    } else {
      seen.set(key, i)
    }
  })
  return dups
}
