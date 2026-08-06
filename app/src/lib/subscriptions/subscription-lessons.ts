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
