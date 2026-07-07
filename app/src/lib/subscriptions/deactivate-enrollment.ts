// Убирание ребёнка из группы при отчислении/аннулировании абонемента.
//
// Правило (критично для календарного типа): каждый месяц — НОВЫЙ Subscription,
// а GroupEnrollment ОДИН на (group, client, ward) и переживает месяцы. Поэтому
// отчисление одного месячного абонемента должно убирать ребёнка из группы
// ТОЛЬКО если у него не осталось другого живого (pending/active) абонемента в
// этой же группе. Иначе ребёнок с оплаченным другим месяцем выпал бы из группы
// и расписания.
//
// Скоуп ребёнка единый: clientId + wardId (wardId=null для взрослого абонемента
// самого клиента — так не задеваются зачисления его детей). Этим же helper'ом
// чинится прежнее расхождение фильтров между PATCH, /refund и cron.
//
// Используется из:
//   - PATCH /api/subscriptions/[id]            (ручное «Отчислить»)
//   - POST  /api/subscriptions/[id]/refund     (отчисление с возвратом)
//   - cron close-unpaid-subscriptions          (автозакрытие неоплаченных)

import { Prisma, type PrismaClient } from "@prisma/client"
import { nextDayUtc } from "./last-paid-lesson-date"
import { repriceSubscription } from "@/lib/discounts/recalc-client-discounts"

type Tx = Prisma.TransactionClient | PrismaClient

export interface DeactivateEnrollmentInput {
  tenantId: string
  groupId: string
  clientId: string
  /** Подопечный; null — взрослый абонемент самого клиента. */
  wardId: string | null
  /** Текущий абонемент — исключается из проверки «есть ли другие живые». */
  excludeSubscriptionId: string
  /**
   * Явная граница состава (withdrawnAt) для ОТЛОЖЕННОГО отчисления (Подход A):
   * ребёнок ходит и платит по факту до даты X, из расписания выпадает после —
   * передаётся X+1. Если задана, используется КАК ЕСТЬ, без вывода по последнему
   * платному занятию: на момент планирования будущих (до X) занятий ещё не было,
   * и вывод по последнему платному выкинул бы ребёнка из расписания немедленно
   * (баг: занятия до даты отчисления пропадали сразу при планировании).
   *
   * Для немедленного отчисления НЕ передаётся: граница = последнее платное
   * занятие ребёнка в группе + 1 день (баг #40).
   */
  scheduledBoundary?: Date
}

/**
 * Деактивирует зачисление (isActive=false, withdrawnAt), но только если у
 * ребёнка не осталось другого живого (pending/active) абонемента в этой группе.
 * Возвращает число деактивированных зачислений (0 — ребёнок оставлен в группе,
 * т.к. есть другой живой абонемент).
 *
 * Граница состава (withdrawnAt) = последнее ПЛАТНОЕ занятие ребёнка в этой группе
 * + 1 день (charge_amount > 0, по всем его абонементам группы; фильтр состава —
 * withdrawnAt > дата занятия, поэтому на последнем платном занятии ребёнок виден,
 * в более поздних — нет). Если платных занятий не было — withdrawnAt = enrolledAt:
 * ребёнок так и не начал платно заниматься и не должен висеть НИ В ОДНОМ занятии
 * (в т.ч. в «Неотмеченных»). Это и есть правило «исчезает с даты последнего
 * платного занятия, а не с даты отчисления абонемента» (баг #40). Дата отчисления
 * абонемента (Subscription.withdrawalDate) — отдельная учётная величина и сюда
 * НЕ влияет.
 *
 * Исключение — ОТЛОЖЕННОЕ отчисление (`scheduledBoundary` задан): граница берётся
 * как есть (X+1), последнее платное занятие НЕ учитывается. Иначе будущие (до X)
 * занятия пропали бы из расписания сразу при планировании — на тот момент их ещё
 * не отметили, и вывод по «последнему платному» дал бы границу в прошлом.
 */
export async function deactivateGroupEnrollmentOnWithdrawal(
  tx: Tx,
  input: DeactivateEnrollmentInput,
): Promise<number> {
  // wardId как string|null Prisma трактует как равенство (в т.ч. IS NULL),
  // поэтому единый скоуп работает и для подопечного, и для взрослого клиента.
  const childScope = { clientId: input.clientId, wardId: input.wardId }

  const otherLive = await tx.subscription.count({
    where: {
      tenantId: input.tenantId,
      groupId: input.groupId,
      status: { in: ["pending", "active"] },
      deletedAt: null,
      id: { not: input.excludeSubscriptionId },
      ...childScope,
    },
  })
  if (otherLive > 0) return 0

  const enrollments = await tx.groupEnrollment.findMany({
    where: {
      tenantId: input.tenantId,
      groupId: input.groupId,
      isActive: true,
      deletedAt: null,
      ...childScope,
    },
    select: { id: true, enrolledAt: true },
  })
  if (enrollments.length === 0) return 0

  // Граница состава (withdrawnAt): withdrawnAt > дата занятия ⇒ занятие в день
  // (граница − 1) показывается, всё что позже — нет.
  let boundary: Date | null
  if (input.scheduledBoundary) {
    // Отложенное отчисление: явная граница X+1. НЕ выводим по последнему платному
    // занятию — будущих (до X) занятий ещё не было, иначе ребёнок выпал бы из
    // расписания сразу при планировании (занятия до X пропадали немедленно).
    boundary = input.scheduledBoundary
  } else {
    // Немедленное отчисление: последнее платное занятие ребёнка именно в ЭТОЙ
    // группе (по всем абонементам) + 1 день.
    const lastPaid = await tx.attendance.findFirst({
      where: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        wardId: input.wardId,
        chargeAmount: { gt: 0 },
        lesson: { groupId: input.groupId },
      },
      orderBy: { lesson: { date: "desc" } },
      select: { lesson: { select: { date: true } } },
    })
    boundary = lastPaid ? nextDayUtc(lastPaid.lesson.date) : null
  }

  let count = 0
  for (const e of enrollments) {
    const withdrawnAt = boundary ?? e.enrolledAt
    await tx.groupEnrollment.update({
      where: { id: e.id },
      // Нет платных занятий → withdrawnAt = enrolledAt (ребёнок невидим везде).
      data: { isActive: false, withdrawnAt },
    })
    // Bug 2: подчистить «висящие» пустые отметки на занятиях ПОСЛЕ границы выбытия
    // (Не был/Уваж. после отчисления задним числом). Ребёнок там уже вне состава,
    // но реестр «Пропуски» читал Attendance напрямую и продолжал их показывать.
    await cleanPostWithdrawalEmptyAttendance(tx, {
      tenantId: input.tenantId,
      groupId: input.groupId,
      clientId: input.clientId,
      wardId: input.wardId,
      cutoff: withdrawnAt,
    })
    count++
  }
  return count
}

/**
 * Bug 2: удаляет «висящие» финансово-пустые отметки посещения (Не был/Уваж./
 * Перерасчёт без списания) на занятиях группы ПОСЛЕ границы выбытия `cutoff`
 * (= withdrawnAt зачисления). Такой ребёнок уже вне состава (расписание и вкладка
 * «Неотмеченные» его прячут по withdrawnAt), но реестр «Пропуски» (вкладка «Не был»)
 * и отчёты по посещениям читают Attendance напрямую и продолжали показывать/считать
 * эти отметки. Удаляем ТОЛЬКО безопасные строки: chargeAmount=0 И instructorPayAmount=0
 * И тип не списывает и не платит педагогу; платные посещения, отработки (isMakeup /
 * scheduledMakeupLessonId), пробные и заглушки (isPending) не трогаем. Разовые
 * посещения без зачисления не затрагиваются: чистка привязана к выбывшему зачислению
 * (client+ward+group), а фильтр по типу/деньгам не даёт задеть платные визиты.
 * Возвращает число удалённых строк.
 *
 * Граница `cutoff` включительна по «занятие вне состава»: занятие в составе, если
 * withdrawnAt > дата занятия, значит date >= withdrawnAt ⇒ вне состава ⇒ подлежит чистке.
 */
export async function cleanPostWithdrawalEmptyAttendance(
  tx: Tx,
  input: {
    tenantId: string
    groupId: string
    clientId: string
    wardId: string | null
    cutoff: Date
  },
): Promise<number> {
  const where = {
    tenantId: input.tenantId,
    clientId: input.clientId,
    wardId: input.wardId,
    chargeAmount: 0,
    instructorPayAmount: 0,
    isPending: false,
    isMakeup: false,
    isTrial: false,
    scheduledMakeupLessonId: null,
    attendanceType: { chargesSubscription: false, paysInstructor: false },
    lesson: {
      groupId: input.groupId,
      date: { gte: input.cutoff },
      status: { not: "cancelled" as const },
    },
  }
  // Сначала собираем затронутые абонементы: несписывающие отметки (Уваж. пропуск/
  // Перерасчёт) расходуют занятие календарного абонемента и влияют на
  // finalAmount/balance — после удаления живые абонементы надо пересчитать
  // (сценарий: отложенное отчисление — абонемент остаётся active до границы X).
  const rows = await tx.attendance.findMany({
    where,
    select: { id: true, subscriptionId: true },
  })
  if (rows.length === 0) return 0

  const res = await tx.attendance.deleteMany({
    where: { id: { in: rows.map((r) => r.id) } },
  })

  const subIds = new Set(rows.map((r) => r.subscriptionId).filter((s): s is string => !!s))
  for (const sid of subIds) {
    // Guard внутри reprice сам пропустит closed/withdrawn/legacy.
    await repriceSubscription(tx, { tenantId: input.tenantId, subscriptionId: sid })
  }
  return res.count
}
