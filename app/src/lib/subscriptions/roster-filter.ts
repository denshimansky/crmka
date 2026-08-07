import type { Prisma, PrismaClient } from "@prisma/client"
import { consumedPackageLessonsMap, packageLessonsRemaining } from "./package-remaining"
import { loadPackageSelections, packageSelectionGate } from "./subscription-lessons"

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

// Живое пробное на конкретном занятии (scheduled/attended/no_show, заявка не
// выведена из воронки). Совпадает с условием отображения пробных в составе.
const LIVE_TRIAL_WHERE: Prisma.TrialLessonWhereInput = {
  status: { in: ["scheduled", "attended", "no_show"] },
  // Пробное выведенной из воронки заявки (soft-deleted) не показываем в составе.
  NOT: { application: { deletedAt: { not: null } } },
}

/**
 * Ключи (clientId:wardId) детей с ЖИВЫМ пробным на этом занятии.
 *
 * Инвариант «пробное побеждает на своём занятии»: ребёнок с пробным на дату D
 * НЕ участвует в платном составе этого занятия (иначе, когда «дату первого
 * платного» ставят = дате пробного, покрывающий/pending абонемент задваивает его
 * как пробника и как платника, а «Отметить всех»/сетка ещё и спишет с абонемента
 * его пробный визит). Платное покрытие действует со следующего занятия периода.
 * Применять ВЕЗДЕ, где строится платный состав занятия: карта занятия, PUT
 * «Отметить всех», сетка «Посещения». Реверс уже закрыт на создании пробного
 * (services/trial-lesson.ts) — здесь закрыт обратный порядок (пробное → абонемент).
 */
export async function trialKeysForLesson(
  db: DB,
  tenantId: string,
  lessonId: string,
): Promise<Set<string>> {
  const trials = await db.trialLesson.findMany({
    where: { tenantId, lessonId, ...LIVE_TRIAL_WHERE },
    select: { clientId: true, wardId: true },
  })
  return new Set(trials.map((t) => coverageKey(t.clientId, t.wardId)))
}

/** Батч-версия trialKeysForLesson для помесячной сетки: Map<lessonId, Set<key>>. */
export async function trialKeysByLesson(
  db: DB,
  tenantId: string,
  lessonIds: string[],
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>()
  if (lessonIds.length === 0) return map
  const trials = await db.trialLesson.findMany({
    where: { tenantId, lessonId: { in: lessonIds }, ...LIVE_TRIAL_WHERE },
    select: { lessonId: true, clientId: true, wardId: true },
  })
  for (const t of trials) {
    if (!t.lessonId) continue
    let set = map.get(t.lessonId)
    if (!set) {
      set = new Set()
      map.set(t.lessonId, set)
    }
    set.add(coverageKey(t.clientId, t.wardId))
  }
  return map
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
  // Занятие, для которого строится состав. Двойная роль: (1) исключается из счёта
  // израсходованного (перезапись своей же отметки не жжёт остаток пакета — прежняя
  // семантика excludeLessonId); (2) для ПАКЕТА С ВЫБОРОМ — проверка членства занятия
  // в наборе SubscriptionLesson (packageSelectionGate). Все вызывающие передают lesson.id.
  lessonId?: string,
): Promise<Set<string>> {
  const packageIds = subs.filter((s) => s.type === "package").map((s) => s.id)
  const consumedById = await consumedPackageLessonsMap(db, tenantId, packageIds, lessonId)
  // Наборы выбранных занятий пакетов (инвариант №1: пусто → легаси-режим).
  const sel = await loadPackageSelections(db, tenantId, packageIds)

  const keys = new Set<string>()
  for (const s of subs) {
    const consumed = s.type === "package" ? consumedById.get(s.id) ?? 0 : 0
    if (!subscriptionCoversDate(s, rosterDate, consumed)) continue
    // Пакет с явным выбором: занятие должно быть в наборе, иначе ученика в составе
    // ЭТОГО занятия нет. Легаси-пакет (нет строк) и календарный → gate=true.
    if (s.type === "package" && lessonId && !packageSelectionGate(sel, s.id, lessonId)) continue
    keys.add(coverageKey(s.clientId, s.wardId))
  }
  return keys
}

/**
 * Резолвер покрытия для МНОГО занятий/дат сразу (сетка посещений, реестр
 * «Неотмеченные», отчёты план/факт). Батч-загружает покрывающие абонементы по всем
 * направлениям диапазона [from..to] и остаток пакетов ОДНИМ groupBy, затем даёт
 * синхронную проверку isCoveredOn(clientId, wardId, directionId, date).
 *
 * Матч по НАПРАВЛЕНИЮ (не по группе): перевод между группами одного направления не
 * теряет покрытие (см. коммент выше про coverageSubscriptionsWhere). Использует ТОТ ЖЕ
 * предикат subscriptionCoversDate, что и карточка занятия, — чтобы все дата-зависимые
 * выборки состава были консистентны и непокрытый ребёнок не показывался/не отмечался.
 *
 * excludeLessonId НЕ применяется: резолвер обслуживает плановые (без отметки) ячейки,
 * где сам урок не в счёте израсходованного; уже отмеченные показываются отдельно.
 */
export interface CoverageResolver {
  // lessonId ОБЯЗАТЕЛЕН (инвариант B-5): TypeScript валит все 4 колл-сайта, чтобы их
  // осознанно обновили — иначе пакет с выбором давал бы ложное покрытие на невыбранном
  // занятии. Для календарных/легаси-пакетов lessonId игнорируется (покрытие по дате).
  isCoveredOn(
    clientId: string,
    wardId: string | null,
    directionId: string,
    date: Date,
    lessonId: string,
  ): boolean
}

export async function buildCoverageResolver(
  db: DB,
  tenantId: string,
  directionIds: string[],
  from: Date,
  to: Date,
): Promise<CoverageResolver> {
  if (directionIds.length === 0) return { isCoveredOn: () => false }

  const subs = await db.subscription.findMany({
    where: coverageSubscriptionsWhere({ tenantId, directionIds, from, to }),
    select: { ...coverageSubscriptionSelect, directionId: true },
  })
  const packageIds = subs.filter((s) => s.type === "package").map((s) => s.id)
  const consumed = await consumedPackageLessonsMap(db, tenantId, packageIds)
  // Наборы выбранных занятий пакетов диапазона (один запрос). Пусто → легаси (инвариант №1).
  const sel = await loadPackageSelections(db, tenantId, packageIds)
  // Ключ: clientId:wardId:directionId → покрывающие абонементы ребёнка по направлению.
  const byKey = new Map<string, typeof subs>()
  for (const s of subs) {
    const k = `${coverageKey(s.clientId, s.wardId)}:${s.directionId}`
    const arr = byKey.get(k)
    if (arr) arr.push(s)
    else byKey.set(k, [s])
  }

  return {
    isCoveredOn(clientId, wardId, directionId, date, lessonId) {
      const arr = byKey.get(`${coverageKey(clientId, wardId)}:${directionId}`)
      if (!arr) return false
      return arr.some((s) => {
        if (!subscriptionCoversDate(s, date, s.type === "package" ? consumed.get(s.id) ?? 0 : 0)) {
          return false
        }
        // Пакет с выбором — только если занятие в наборе; легаси/календарный → true.
        return s.type !== "package" || packageSelectionGate(sel, s.id, lessonId)
      })
    },
  }
}

/** Занятие для проверки «есть кого отмечать» (минимальный набор полей). */
export interface RosterLessonInput {
  id: string
  date: Date
  rescheduledFromDate: Date | null
  groupId: string
  directionId: string
}

/**
 * Из набора занятий возвращает id тех, у кого на их дату ЕСТЬ КОГО ОТМЕЧАТЬ —
 * хотя бы один зачисленный ребёнок в составе с покрывающим абонементом (тот же
 * гейт, что в карточке занятия и отчёте «Неотмеченные»). Пустые занятия — в группе
 * в тот день никого (все выбыли, ещё никто не зачислён, нет покрытия) — в результат
 * НЕ попадают: их «неотмеченными» считать нельзя, отмечать там нечего (баг #114).
 *
 * Один батч: enrollments по всем группам + единый резолвер покрытия на диапазон дат.
 * selectedDays (частичная неделя) сверяем по фактическому дню занятия — как в отчёте.
 */
export async function lessonsWithRoster(
  db: DB,
  tenantId: string,
  lessons: RosterLessonInput[],
): Promise<Set<string>> {
  const result = new Set<string>()
  if (lessons.length === 0) return result

  const groupIds = [...new Set(lessons.map((l) => l.groupId))]
  const enrollments = await db.groupEnrollment.findMany({
    where: { tenantId, groupId: { in: groupIds }, deletedAt: null, ...rosterWhereAnyDate() },
    select: {
      groupId: true,
      clientId: true,
      wardId: true,
      enrolledAt: true,
      withdrawnAt: true,
      selectedDays: true,
    },
  })
  const byGroup = new Map<string, typeof enrollments>()
  for (const e of enrollments) {
    const list = byGroup.get(e.groupId)
    if (list) list.push(e)
    else byGroup.set(e.groupId, [e])
  }

  // Окно покрытия — по датам состава (при переносе — исходная дата).
  let from = effectiveRosterDate(lessons[0])
  let to = from
  for (const l of lessons) {
    const d = effectiveRosterDate(l)
    if (d < from) from = d
    if (d > to) to = d
  }
  const coverage = await buildCoverageResolver(
    db,
    tenantId,
    [...new Set(lessons.map((l) => l.directionId))],
    from,
    to,
  )

  for (const l of lessons) {
    const rosterDate = effectiveRosterDate(l)
    // selectedDays — по фактическому дню занятия (как в отчёте «Неотмеченные»).
    const dow = l.date.getUTCDay() === 0 ? 7 : l.date.getUTCDay()
    const list = byGroup.get(l.groupId)
    if (!list) continue
    const has = list.some((e) => {
      if (!isEnrolledOnLesson(e, rosterDate)) return false
      if (!coverage.isCoveredOn(e.clientId, e.wardId, l.directionId, rosterDate, l.id)) return false
      if (e.selectedDays && Array.isArray(e.selectedDays)) {
        return (e.selectedDays as number[]).includes(dow)
      }
      return true
    })
    if (has) result.add(l.id)
  }
  return result
}
