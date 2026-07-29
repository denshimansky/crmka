// Остаток занятий пакетного абонемента (несгоревшие занятия).
//
// ВАЖНО: критерий «пакет ещё можно списывать» — это ОСТАТОК ЗАНЯТИЙ
// (totalLessons − израсходовано), а НЕ остаток к оплате (balance). Полностью
// оплаченный пакет (balance=0) с невыгоревшими занятиями обязан находиться
// автоподбором и покрывать состав — иначе визит уходит в разовое с баланса
// родителя (баг: списание через сетку «Посещения» не находило оплаченный пакет).
//
// «Израсходовано» считаем ТОЧНО как денежный пересчёт (recalc-client-discounts
// recomputeMoney: remaining = totalLessons − attended). Для пакета израсходованы
// только СПИСЫВАЮЩИЕ отметки (chargesSubscription=true) — уваж. пропуск занятие
// пакета не сжигает. Источник истины — consumedTypeWhereFor("package").

import { Prisma, type PrismaClient } from "@prisma/client"
import { consumedTypeWhereFor } from "./consumed-lessons"

type DB = PrismaClient | Prisma.TransactionClient

/** Осталось несгоревших занятий пакета (не меньше нуля). */
export function packageLessonsRemaining(totalLessons: number, consumed: number): number {
  return Math.max(0, totalLessons - consumed)
}

/**
 * Батч-подсчёт израсходованных занятий по списку пакетных абонементов.
 *
 * excludeLessonId — исключить отметки ЭТОГО занятия из счёта. Нужно при резолве
 * абонемента для отметки на конкретном занятии: перезапись уже проведённой
 * отметки (напр. «Был» → «Прогул») не должна считать сам этот урок «занятым» и
 * тем самым обнулять остаток последнего пакета — иначе повторная отметка на
 * исчерпанном пакете ушла бы в разовое. Для роли «показать в составе» безвредно:
 * гейтятся только ученики без отметки на этом занятии.
 *
 * Возвращает Map<subscriptionId, израсходовано>. Отсутствующий ключ = 0.
 */
export async function consumedPackageLessonsMap(
  db: DB,
  tenantId: string,
  subscriptionIds: string[],
  excludeLessonId?: string,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (subscriptionIds.length === 0) return result

  const grouped = await db.attendance.groupBy({
    by: ["subscriptionId"],
    where: {
      tenantId,
      subscriptionId: { in: subscriptionIds },
      attendanceType: consumedTypeWhereFor("package"),
      ...(excludeLessonId ? { lessonId: { not: excludeLessonId } } : {}),
    },
    _count: { _all: true },
  })
  for (const g of grouped) {
    if (g.subscriptionId) result.set(g.subscriptionId, g._count._all)
  }
  return result
}

/**
 * Выбор абонемента для списания из уже загруженного набора (bulk «Отметить всех»,
 * где абонементы клиента уже в памяти). Семантика повторяет резолвер POST:
 *  - пакетный: самый старый (FIFO по startDate) пакет с ОСТАТКОМ занятий > 0;
 *  - календарный/фиксированный: как раньше — первый подходящий (на месяц один).
 * Возвращает null, если пакеты исчерпаны (тогда caller уводит в разовое).
 */
export function pickChargeableSubscription<
  T extends { id: string; type: string; startDate: Date; totalLessons: number },
>(subs: T[], consumedById: Map<string, number>): T | null {
  const packages = subs.filter((s) => s.type === "package")
  if (packages.length > 0) {
    return (
      [...packages]
        .filter((s) => packageLessonsRemaining(s.totalLessons, consumedById.get(s.id) ?? 0) > 0)
        .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null
    )
  }
  return subs[0] ?? null
}
