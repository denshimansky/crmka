// Единая логика «состав группы на дату» (граница по withdrawnAt). Используется во
// ВСЕХ дата-зависимых выборках состава занятия/сетки/отчётов, чтобы они не
// расходились (раньше каждое место дублировало фильтр и часть была неполной).
//
// Семантика: ученик входит в состав занятия на дату D, если зачислён (enrolledAt
// <= D) и НЕ выбыл к этому моменту (withdrawnAt IS NULL ИЛИ withdrawnAt > D). При
// отчислении withdrawnAt = последнее_платное + 1, поэтому последнее платное занятие
// (день D) входит в состав, а более поздние — нет.
//
// Инвариант (проверен по всем деактивациям — deactivate-enrollment, enrollments/[id],
// transfer): isActive=false ВСЕГДА идёт вместе с withdrawnAt. Значит «активные» —
// это withdrawnAt IS NULL, и второй ветке OR нужен isActive=true.

/**
 * «Дата состава» занятия. При переносе (Перенести → PATCH /api/lessons/[id]) поле
 * `date` перезаписывается новой датой, а исходная сохраняется в `rescheduledFromDate`.
 * Состав занятия и резолв абонемента нужно считать по ИСХОДНОЙ дате: перенос на
 * более поздний день не должен затягивать в занятие учеников, начавших заниматься
 * позже исходной даты (их абонемент это занятие не покрывает). Если занятие не
 * переносили — `rescheduledFromDate` пустой, и берётся текущая `date`.
 *
 * Использовать ВЕЗДЕ, где определяется «кто на этом конкретном занятии» по дате:
 * rosterWhereOnDate, enrolledAt <= …, Subscription.startDate <= …, период абонемента,
 * isEnrolledOnLesson. НЕ использовать для отображения даты/времени, проверки
 * конфликтов расписания и расчёта ЗП (ЗП — по фактической дате проведения `date`).
 */
export function effectiveRosterDate(lesson: {
  date: Date
  rescheduledFromDate?: Date | null
}): Date {
  return lesson.rescheduledFromDate ?? lesson.date
}

/**
 * Prisma where-фрагмент: зачисление активно на конкретную дату `date` (или начиная
 * с неё — для запросов по диапазону, где точная граница по дню затем проверяется
 * isEnrolledOnLesson). Спредить в where рядом с tenantId/groupId/deletedAt; поле
 * enrolledAt добавляйте отдельно при необходимости.
 */
export function rosterWhereOnDate(date: Date) {
  return {
    OR: [
      { withdrawnAt: { gt: date } },
      { withdrawnAt: null, isActive: true },
    ],
  }
}

/**
 * Prisma where-фрагмент без привязки к дате: активные + любые выбывшие (для запросов,
 * где набор занятий охватывает разные даты, а точная граница применяется по каждому
 * занятию через isEnrolledOnLesson). Загружает чуть больше строк (выбывших), которые
 * затем отсекаются по дню.
 */
export function rosterWhereAnyDate() {
  return {
    OR: [{ isActive: true }, { withdrawnAt: { not: null } }],
  }
}

/**
 * Входит ли зачисление в состав занятия на дату `lessonDate` (учёт enrolledAt и
 * границы withdrawnAt). Для in-memory фильтрации по конкретному занятию/дню.
 */
export function isEnrolledOnLesson(
  e: { enrolledAt: Date; withdrawnAt: Date | null },
  lessonDate: Date,
): boolean {
  if (e.enrolledAt > lessonDate) return false
  if (e.withdrawnAt && e.withdrawnAt <= lessonDate) return false
  return true
}
