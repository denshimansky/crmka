import type { Prisma, PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

/** Кто занимает кабинет в проверяемый слот. */
export interface RoomOccupant {
  kind: "lesson" | "trial"
  startTime: string
  /** Название группы (kind=lesson) или имя ребёнка/родителя пробного (kind=trial). */
  label: string
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number)
  return (h || 0) * 60 + (m || 0)
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
 * Занят ли кабинет в указанный слот (баг #61): в одном кабинете одновременно
 * может идти только одно занятие группы (включая разовые isOneTime) ИЛИ одно
 * индивидуальное пробное. Возвращает первого занявшего или null.
 *
 * Пробные, привязанные к занятию группы (lessonId != null), кабинет отдельно
 * не занимают — ребёнок сидит внутри группового занятия.
 *
 * Проверяется на путях СОЗДАНИЯ занятости: разовое занятие, индивидуальное
 * пробное (включая перенос), перенос занятия. Генерацию из шаблонов групп не
 * трогаем — пересечения шаблонов ловит findRoomScheduleConflicts при
 * создании/правке группы.
 */
export async function findRoomOccupant(
  tx: Tx,
  opts: {
    tenantId: string
    roomId: string
    /** Дата слота — полночь UTC, как Lesson.date / TrialLesson.scheduledDate (@db.Date). */
    date: Date
    startTime: string
    durationMinutes: number
    /** Не считать конфликтом само переносимое занятие. */
    excludeLessonId?: string
    /** Не считать конфликтом переносимое пробное (rescheduleOfTrialLessonId). */
    excludeTrialLessonId?: string
  },
): Promise<RoomOccupant | null> {
  const start = timeToMinutes(opts.startTime)

  const [lessons, trials] = await Promise.all([
    tx.lesson.findMany({
      where: {
        tenantId: opts.tenantId,
        date: opts.date,
        status: { not: "cancelled" },
        group: { roomId: opts.roomId },
        ...(opts.excludeLessonId ? { id: { not: opts.excludeLessonId } } : {}),
      },
      select: {
        startTime: true,
        durationMinutes: true,
        group: { select: { name: true } },
      },
    }),
    tx.trialLesson.findMany({
      where: {
        tenantId: opts.tenantId,
        roomId: opts.roomId,
        scheduledDate: opts.date,
        status: "scheduled",
        lessonId: null,
        ...(opts.excludeTrialLessonId ? { id: { not: opts.excludeTrialLessonId } } : {}),
      },
      select: {
        startTime: true,
        durationMinutes: true,
        ward: { select: { firstName: true, lastName: true } },
        client: { select: { firstName: true, lastName: true } },
      },
    }),
  ])

  for (const l of lessons) {
    if (intervalsOverlap(start, opts.durationMinutes, timeToMinutes(l.startTime), l.durationMinutes)) {
      return { kind: "lesson", startTime: l.startTime, label: l.group.name }
    }
  }
  for (const t of trials) {
    if (!t.startTime) continue // без времени слот не занимает
    if (intervalsOverlap(start, opts.durationMinutes, timeToMinutes(t.startTime), t.durationMinutes ?? 60)) {
      const child = t.ward
        ? [t.ward.lastName, t.ward.firstName].filter(Boolean).join(" ")
        : [t.client.lastName, t.client.firstName].filter(Boolean).join(" ")
      return { kind: "trial", startTime: t.startTime, label: child || "—" }
    }
  }
  return null
}

/** Текст ошибки 409 — кто занял кабинет. */
export function roomOccupiedMessage(roomName: string | null, o: RoomOccupant): string {
  const room = roomName ? `Кабинет «${roomName}»` : "Кабинет"
  return o.kind === "lesson"
    ? `${room} занят: группа «${o.label}» в ${o.startTime}`
    : `${room} занят: индивидуальное пробное (${o.label}) в ${o.startTime}`
}
