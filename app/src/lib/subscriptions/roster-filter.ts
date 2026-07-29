import type { Prisma, PrismaClient } from "@prisma/client"
import { consumedPackageLessonsMap, packageLessonsRemaining } from "./package-remaining"

type DB = PrismaClient | Prisma.TransactionClient

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

// ── Покрывающий абонемент ──────────────────────────────────────────────────
//
// Правило (решение владельца 14.07.2026): зачисление даёт место в составе
// занятия, только если на дату состава у ребёнка есть ПОКРЫВАЮЩИЙ абонемент.
// Ребёнок без абонемента на месяц занятия в составе не показывается (кейс:
// абонемент выписали на прошлый месяц — ребёнок продолжал висеть в расписании,
// и «Был» уходил в разовое списание с баланса родителя). Ученики с уже
// существующей отметкой (Attendance, вкл. placeholder разовых), пробные
// (TrialLesson) и отработки остаются видимыми независимо от покрытия.
//
// Покрытие:
// - календарный/фиксированный: periodYear/periodMonth = месяц даты состава
//   И startDate <= дата (границу начала задаёт абонемент, а не enrolledAt —
//   переоформление задним числом расширяет состав назад). Статусы: active,
//   pending («выписан, ждём оплату» — состав наполняется сразу после массовой
//   выписки) и closed (историю прошлых месяцев кроном переводит в closed —
//   без него ретро-составы опустели бы). withdrawn НЕ покрывает.
// - пакетный: startDate <= дата, не истёк (expiresAt), ЕСТЬ несгоревшие занятия
//   (totalLessons − израсходовано > 0) — как в резолвере списания. Полностью
//   оплаченный пакет (balance=0) с остатком занятий покрывает состав; критерий
//   не по balance (остаток к оплате), а по остатку ЗАНЯТИЙ. Статусы: active,
//   pending.
//
// Матч по НАПРАВЛЕНИЮ (directionId), а не по группе занятия: перевод между
// группами не переносит groupId абонемента (признанный пробел — bulk-renew
// воспроизводит старый groupId), матч по направлению сохраняет переведённых
// в составе новой группы. Группу задаёт само зачисление.

/** Поля абонемента, достаточные для предиката покрытия. */
export type CoverageSubscription = {
  id: string
  clientId: string
  wardId: string | null
  type: string
  status: string
  periodYear: number | null
  periodMonth: number | null
  startDate: Date
  expiresAt: Date | null
  // Пакет покрывает по остатку ЗАНЯТИЙ (totalLessons − израсходовано), а не по
  // balance. Число израсходованных подгружается батчем в coverageKeysOnDate.
  totalLessons: number
}

/** select-фрагмент Prisma под CoverageSubscription. */
export const coverageSubscriptionSelect = {
  id: true,
  clientId: true,
  wardId: true,
  type: true,
  status: true,
  periodYear: true,
  periodMonth: true,
  startDate: true,
  expiresAt: true,
  totalLessons: true,
} as const

/** Единый ключ «ребёнок» для матчинга зачисление ↔ абонемент ↔ отметка. */
export function coverageKey(clientId: string, wardId: string | null | undefined): string {
  return `${clientId}:${wardId || ""}`
}

/**
 * Prisma-where: кандидаты в покрывающие абонементы для занятий диапазона
 * [from..to] (для одного занятия from = to = дата состава). Выборка — надмножество:
 * точное покрытие конкретной даты проверяется в JS через subscriptionCoversDate
 * (месяц периода, границы startDate/expiresAt).
 */
export function coverageSubscriptionsWhere(args: {
  tenantId: string
  directionIds: string[]
  from: Date
  to?: Date
}): Prisma.SubscriptionWhereInput {
  const { tenantId, directionIds, from } = args
  const to = args.to ?? from
  // Все календарные месяцы диапазона
  const periods: { periodYear: number; periodMonth: number }[] = []
  let y = from.getFullYear()
  let m = from.getMonth() + 1
  const endY = to.getFullYear()
  const endM = to.getMonth() + 1
  while (y < endY || (y === endY && m <= endM)) {
    periods.push({ periodYear: y, periodMonth: m })
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return {
    tenantId,
    directionId: { in: directionIds },
    deletedAt: null,
    OR: [
      {
        status: { in: ["active", "pending", "closed"] },
        OR: periods,
      },
      {
        // Остаток занятий (totalLessons − израсходовано) в SQL не выразить —
        // берём надмножество активных/pending пакетов в сроке, точный остаток
        // проверяет coverageKeysOnDate по батч-подсчёту. Фильтр balance>0 УБРАН:
        // полностью оплаченный пакет с занятиями обязан покрывать состав.
        type: "package",
        status: { in: ["active", "pending"] },
        startDate: { lte: to },
        OR: [{ expiresAt: null }, { expiresAt: { gte: from } }],
      },
    ],
  }
}

/**
 * Покрывает ли абонемент дату состава занятия. Для пакета `consumed` — число
 * израсходованных занятий (из батч-подсчёта); покрытие есть, пока остаток > 0.
 */
export function subscriptionCoversDate(
  s: CoverageSubscription,
  rosterDate: Date,
  consumed = 0,
): boolean {
  if (s.type === "package") {
    return (
      (s.status === "active" || s.status === "pending") &&
      s.startDate <= rosterDate &&
      (!s.expiresAt || s.expiresAt >= rosterDate) &&
      packageLessonsRemaining(s.totalLessons, consumed) > 0
    )
  }
  if (s.status !== "active" && s.status !== "pending" && s.status !== "closed") return false
  return (
    s.periodYear === rosterDate.getFullYear() &&
    s.periodMonth === rosterDate.getMonth() + 1 &&
    s.startDate <= rosterDate
  )
}

/**
 * Ключи детей, покрытых абонементом на дату состава. Для пакетов остаток занятий
 * считается батчем (одним groupBy), поэтому функция асинхронная. excludeLessonId —
 * исключить отметки этого занятия из счёта израсходованного (см.
 * consumedPackageLessonsMap): роль гейта — ученики без отметки на этом занятии,
 * им исключение безвредно, а для повторной отметки оно не даёт «занять» самим
 * этим уроком остаток пакета.
 */
export async function coverageKeysOnDate(
  db: DB,
  tenantId: string,
  subs: CoverageSubscription[],
  rosterDate: Date,
  excludeLessonId?: string,
): Promise<Set<string>> {
  const packageIds = subs.filter((s) => s.type === "package").map((s) => s.id)
  const consumedById = await consumedPackageLessonsMap(db, tenantId, packageIds, excludeLessonId)

  const keys = new Set<string>()
  for (const s of subs) {
    const consumed = s.type === "package" ? consumedById.get(s.id) ?? 0 : 0
    if (subscriptionCoversDate(s, rosterDate, consumed)) {
      keys.add(coverageKey(s.clientId, s.wardId))
    }
  }
  return keys
}
