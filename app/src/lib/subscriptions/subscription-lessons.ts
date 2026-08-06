// Явный выбор конкретных занятий для пакетного абонемента
// (docs/package-lesson-selection-plan.md). Единый источник истины гейта «пакет
// вправе покрывать/списывать это занятие» — чтобы резолвер состава, POST-FIFO и
// bulk «Отметить всех» не разошлись (иначе баг «показали в составе, списали разовым»).
//
// ИНВАРИАНТ №1 (сохранность прод-данных): hasSelection определяется ПЕР-АБОНЕМЕНТНО —
// по факту наличия строк SubscriptionLesson у ЭТОГО subscriptionId, НИКОГДА по
// org.subscriptionType/фиче-флагу. Легаси-пакет (0 строк) → gate=true → покрытие
// и списание идут по старому правилу packageLessonsRemaining>0, как до фичи.
//
// ИНВАРИАНТ №2: эта таблица влияет ТОЛЬКО на покрытие/право отметки/вместимость.
// «Израсходовано/остаток» ВСЕГДА считается по Attendance (package-remaining.ts) —
// сюда не заглядывает. Кроны истечения/уведомления не трогаются.

import type { Prisma, PrismaClient } from "@prisma/client"
import { consumedPackageLessonsMap, packageLessonsRemaining } from "./package-remaining"

type DB = PrismaClient | Prisma.TransactionClient

export interface PackageSelection {
  /** subscriptionId → множество выбранных lessonId (explicit-режим). */
  byLesson: Map<string, Set<string>>
  /** subscriptionId, у которых есть ≥1 строка выбора. Пусто → пакет легаси. */
  hasSelection: Set<string>
}

/**
 * Батч-загрузка наборов выбранных занятий по списку пакетных абонементов —
 * один findMany по subscription_lessons. Пустой вход → пустой результат.
 */
export async function loadPackageSelections(
  db: DB,
  tenantId: string,
  subscriptionIds: string[],
): Promise<PackageSelection> {
  const byLesson = new Map<string, Set<string>>()
  const hasSelection = new Set<string>()
  if (subscriptionIds.length === 0) return { byLesson, hasSelection }

  const rows = await db.subscriptionLesson.findMany({
    where: { tenantId, subscriptionId: { in: subscriptionIds } },
    select: { subscriptionId: true, lessonId: true },
  })
  for (const r of rows) {
    hasSelection.add(r.subscriptionId)
    let set = byLesson.get(r.subscriptionId)
    if (!set) {
      set = new Set<string>()
      byLesson.set(r.subscriptionId, set)
    }
    set.add(r.lessonId)
  }
  return { byLesson, hasSelection }
}

/**
 * Единый предикат «пакет вправе покрывать/списывать это занятие».
 * ЛЕГАСИ (нет строк у sub) → true: старое правило remaining>0 проверяет вызывающий.
 * EXPLICIT → true только если lessonId в наборе выбранных.
 *
 * Применять во ВСЕХ точках, где решается «этот пакет и это занятие»:
 * subscriptionCoversDate/coverageKeysOnDate/buildCoverageResolver (покрытие),
 * POST-FIFO резолвер и pickChargeableSubscription (списание).
 */
export function packageSelectionGate(
  sel: PackageSelection,
  subscriptionId: string,
  lessonId: string,
): boolean {
  if (!sel.hasSelection.has(subscriptionId)) return true
  return sel.byLesson.get(subscriptionId)?.has(lessonId) ?? false
}

// ── Валидация выбора при создании/правке пакета ──────────────────────────────

/** Полночь UTC (сравнение окна по дням — Lesson.date хранится как @db.Date). */
function dayFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export interface ValidateSelectionInput {
  tenantId: string
  groupId: string
  clientId: string
  wardId: string | null
  /** Вместимость занятия (Group.maxStudents). */
  maxStudents: number
  /** Сколько занятий должно быть выбрано (= totalLessons пакета). */
  totalLessons: number
  /** Окно действия пакета [startDate .. expiresAt]. */
  windowStart: Date
  windowEnd: Date | null
  /** Массив выбранных занятий (обязателен и непуст для этой проверки). */
  selectedLessonIds: string[]
  /** Исключить из проверок кросс-пакета/вместимости (для swap существующего). */
  excludeSubscriptionId?: string
}

export type ValidateSelectionResult =
  | { ok: true; lessonIds: string[] }
  | { ok: false; error: string; status: number }

/**
 * Read-only проверка набора выбранных занятий пакета. Возвращает валидированный
 * список либо ошибку с HTTP-статусом. Вызывать в ОБОИХ путях создания (и в swap).
 * Инвариант №3: членство/кросс-пакет резолвятся через (clientId, wardId).
 *
 * Гонка вместимости (TOCTOU) закрыта частично — окончательный барьер (advisory-lock)
 * — задача hardening; для малых центров конкуренция на одно занятие практически нулевая.
 */
export async function validateSelectedLessons(
  db: DB,
  input: ValidateSelectionInput,
): Promise<ValidateSelectionResult> {
  const {
    tenantId, groupId, clientId, wardId, maxStudents, totalLessons,
    windowStart, windowEnd, selectedLessonIds: ids, excludeSubscriptionId,
  } = input
  const err = (error: string, status: number): ValidateSelectionResult => ({ ok: false, error, status })

  if (new Set(ids).size !== ids.length) return err("Одно занятие выбрано несколько раз", 400)
  if (ids.length !== totalLessons) {
    return err(`Нужно выбрать ровно ${totalLessons} занятий (выбрано ${ids.length})`, 400)
  }

  const lessons = await db.lesson.findMany({
    where: { tenantId, groupId, id: { in: ids }, status: { in: ["scheduled", "completed"] } },
    select: { id: true, date: true, rescheduledFromDate: true },
  })
  if (lessons.length !== ids.length) {
    return err("Некоторые занятия не найдены, отменены или не принадлежат этой группе", 400)
  }

  // Окно по дате состава (исходная дата при переносе). Прошлые занятия разрешены
  // (поддержан back-dated старт — enrolledAt задним числом): нижняя граница = startDate.
  const wStart = dayFloor(windowStart).getTime()
  const wEnd = windowEnd ? dayFloor(windowEnd).getTime() : null
  for (const l of lessons) {
    const d = dayFloor(l.rescheduledFromDate ?? l.date).getTime()
    if (d < wStart || (wEnd !== null && d > wEnd)) {
      return err("Выбранное занятие вне срока действия пакета", 400)
    }
  }

  // Кросс-пакет (F-22): занятие уже входит в ДРУГОЙ живой пакет того же подопечного.
  const clash = await db.subscriptionLesson.findFirst({
    where: {
      tenantId,
      lessonId: { in: ids },
      subscription: {
        clientId, wardId, groupId,
        type: "package", status: { in: ["pending", "active"] }, deletedAt: null,
        ...(excludeSubscriptionId ? { id: { not: excludeSubscriptionId } } : {}),
      },
    },
    select: { lessonId: true },
  })
  if (clash) return err("Занятие уже входит в другой пакет подопечного", 409)

  // Вместимость (D-12): на каждом выбранном занятии число живых пакет-выборов < maxStudents.
  const counts = await db.subscriptionLesson.groupBy({
    by: ["lessonId"],
    where: {
      tenantId,
      lessonId: { in: ids },
      subscription: {
        type: "package", status: { in: ["pending", "active"] }, deletedAt: null,
        ...(excludeSubscriptionId ? { id: { not: excludeSubscriptionId } } : {}),
      },
    },
    _count: { _all: true },
  })
  if (counts.some((c) => c._count._all >= maxStudents)) {
    return err("На одном из выбранных занятий нет свободных мест", 409)
  }

  return { ok: true, lessonIds: ids }
}

// ── Блокировка отметки вне плана (решение владельца №1) ──────────────────────

/**
 * Нужно ли ЗАБЛОКИРОВАТЬ списывающую отметку на этом занятии (решение владельца №1:
 * не drop-in, а ошибка). Блок = у ученика есть живой пакет С ВЫБОРОМ на эту группу
 * с остатком занятий, но НИ ОДИН его живой пакет не покрывает это занятие.
 *
 * Три исхода (guard C-8):
 *  - есть валидный пакет (выбрано ИЛИ легаси с остатком) → false (спишется штатно);
 *  - валидного нет, НО есть пакет с выбором-без-этого-занятия → true (блок);
 *  - пакета нет вовсе / все исчерпаны (remaining=0) → false (законное разовое).
 *
 * НЕ звать для отработки (списывается со слота исходного L1) и пробного — там
 * своя семантика (гейт в attendance route стоит за !isMakeupArrival && !isTrial).
 */
export async function isBlockedByPackageSelection(
  db: DB,
  args: {
    tenantId: string
    clientId: string
    wardId: string | null
    groupId: string
    lessonId: string
    lessonDate: Date
  },
): Promise<boolean> {
  const { tenantId, clientId, wardId, groupId, lessonId, lessonDate } = args
  const candidates = await db.subscription.findMany({
    where: {
      tenantId,
      clientId,
      groupId,
      type: "package",
      deletedAt: null,
      status: { in: ["active", "pending"] },
      startDate: { lte: lessonDate },
      OR: [{ expiresAt: null }, { expiresAt: { gte: lessonDate } }],
      // Как в FIFO-резолвере списания: строгий ward, если задан.
      ...(wardId ? { wardId } : {}),
    },
    select: { id: true, totalLessons: true },
  })
  if (candidates.length === 0) return false

  const ids = candidates.map((c) => c.id)
  const consumed = await consumedPackageLessonsMap(db, tenantId, ids, lessonId)
  const sel = await loadPackageSelections(db, tenantId, ids)

  let hasValid = false
  let hasBlocking = false
  for (const c of candidates) {
    if (packageLessonsRemaining(c.totalLessons, consumed.get(c.id) ?? 0) <= 0) continue
    if (packageSelectionGate(sel, c.id, lessonId)) hasValid = true
    else hasBlocking = true // живой пакет с выбором, но занятие не в наборе
  }
  return !hasValid && hasBlocking
}
