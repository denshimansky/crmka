// Дельта-пересчёт календарных абонементов при физическом изменении расписания
// группы (создание/удаление занятий).
//
// Проблема («7 вместо 8», Майнкрафт 07.2026): выписка календарного абонемента
// фиксирует totalLessons снимком текущего расписания, но расписание живёт
// дальше — продление группы (сдвиг endDate), догенерация/копирование месяца
// добавляют занятия, удаление занятия и перегенерация убирают. Абонементы
// периода оставались со старым количеством и суммой: ребёнок стоит в составе
// нового занятия (roster идёт от Subscription.startDate), а платит за меньшее
// число занятий.
//
// Решение — дельта, а не абсолютный пересчёт: каждому живому (pending/active)
// календарному абонементу группы прибавляем/убавляем ровно те занятия, что
// попали в его личный диапазон (prorationRange: от max(startDate, начало
// периода) до конца периода либо запланированного отчисления). Оператор мог
// сознательно выписать меньше занятий, чем в расписании (например, ходит раз
// в неделю при двух в группе) — абсолютный пересчёт перетёр бы такой план,
// дельта лишь сдвигает его на фактическое изменение расписания.
//
// Деньги — той же цепочкой, что PATCH /api/subscriptions/[id] и
// reschedule-start: totalAmount = lessonPrice × totalLessons; legacy-скидка —
// замороженная формула (finalAmount = totalAmount − discountAmount, balance =
// finalAmount − оплачено); остальным recalcClientDiscounts (мог смениться
// «самый дорогой» месяца для автоскидки) + repriceSubscription (finalAmount/
// balance конкретного абонемента, даже если его скидка не изменилась).
//
// Вне скоупа (сознательно):
// - отмена занятия (status='cancelled') — вариант A: отменённые занятия НЕ
//   декрементят totalLessons (см. close-finished-calendar-subscriptions.ts);
//   поэтому и физическое удаление УЖЕ отменённого занятия дельту не даёт —
//   вызывающий код не включает его в removedDates;
// - перенос занятия — состав и период считаются по исходной дате
//   (rescheduledFromDate/effectiveRosterDate), количество не меняется;
// - пакетные абонементы — у них totalLessons купленное количество, не план.

import { Prisma, type PrismaClient } from "@prisma/client"
import {
  recalcClientDiscounts,
  repriceSubscription,
} from "@/lib/discounts/recalc-client-discounts"
import { prorationRange } from "./prorate-scheduled-withdrawal"

type Tx = Prisma.TransactionClient | PrismaClient

export interface ScheduleChangeSubscription {
  id: string
  clientId: string
  type: string
  status: string
  startDate: Date | null
  endDate: Date | null
  periodYear: number | null
  periodMonth: number | null
  expiresAt?: Date | null
  scheduledWithdrawalDate: Date | null
  totalLessons: number
  lessonPrice: Prisma.Decimal | number
  discountAmount: Prisma.Decimal | number
  discountSource: string
}

/**
 * Дельта одного абонемента: сколько из добавленных/удалённых занятий попало
 * в его личный диапазон. Диапазон учитывает поздний старт (startDate) и
 * запланированное отчисление (занятия после X абонемент не покрывает — их
 * уже срезал prorateScheduledWithdrawal).
 */
export function scheduleChangeDelta(
  sub: ScheduleChangeSubscription,
  addedDates: Date[],
  removedDates: Date[],
): number {
  const range = prorationRange(sub, sub.scheduledWithdrawalDate ?? null)
  if (!range) return 0
  const inRange = (d: Date) =>
    d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime()
  return addedDates.filter(inRange).length - removedDates.filter(inRange).length
}

/**
 * Пересчитывает totalLessons/деньги живых календарных абонементов группы после
 * физического добавления/удаления занятий. addedDates/removedDates — даты
 * созданных и удалённых занятий (отменённые статусом сюда не передавать).
 * Возвращает число изменённых абонементов.
 */
export async function recalcSubscriptionsOnScheduleChange(
  db: Tx,
  params: {
    tenantId: string
    groupId: string
    addedDates: Date[]
    removedDates: Date[]
    createdBy?: string | null
  },
): Promise<{ updated: number }> {
  const { tenantId, groupId, addedDates, removedDates } = params
  if (addedDates.length === 0 && removedDates.length === 0) {
    return { updated: 0 }
  }

  // Только живые: у закрытых/отчисленных balance выставлен сверкой закрытия —
  // пересчёт перетёр бы его (тот же guard, что в prorateScheduledWithdrawal).
  const subs = (await db.subscription.findMany({
    where: {
      tenantId,
      groupId,
      type: "calendar",
      status: { in: ["pending", "active"] },
      deletedAt: null,
    },
    select: {
      id: true,
      clientId: true,
      type: true,
      status: true,
      startDate: true,
      endDate: true,
      periodYear: true,
      periodMonth: true,
      expiresAt: true,
      scheduledWithdrawalDate: true,
      totalLessons: true,
      lessonPrice: true,
      discountAmount: true,
      discountSource: true,
    },
  })) as ScheduleChangeSubscription[]

  const repriceIds: string[] = []
  const clientIds = new Set<string>()
  let updated = 0

  for (const sub of subs) {
    const delta = scheduleChangeDelta(sub, addedDates, removedDates)
    if (delta === 0) continue
    const newTotal = Math.max(0, sub.totalLessons + delta)
    if (newTotal === sub.totalLessons) continue

    const lessonPrice = Number(sub.lessonPrice)
    const totalAmount = lessonPrice * newTotal
    const updateData: {
      totalLessons: number
      totalAmount: number
      finalAmount?: number
      balance?: number
    } = { totalLessons: newTotal, totalAmount }

    if (sub.discountSource === "legacy") {
      // Легаси: скидка заморожена в рублях — формула из PATCH (правка занятий).
      const finalAmount = totalAmount - Number(sub.discountAmount)
      const paidSum = await db.payment.aggregate({
        where: { tenantId, subscriptionId: sub.id, deletedAt: null },
        _sum: { amount: true },
      })
      updateData.finalAmount = finalAmount
      updateData.balance = finalAmount - Number(paidSum._sum.amount || 0)
    } else {
      repriceIds.push(sub.id)
    }

    await db.subscription.update({ where: { id: sub.id }, data: updateData })
    clientIds.add(sub.clientId)
    updated++
  }

  // Порядок как в reschedule-start: сначала скидки клиента (изменился
  // totalAmount — мог смениться «самый дорогой» месяца), затем reprice
  // каждого изменённого абонемента — гарантирует, что его finalAmount/balance
  // отражают новое количество занятий, даже если скидка не поменялась.
  for (const clientId of clientIds) {
    await recalcClientDiscounts(db, {
      tenantId,
      clientId,
      createdBy: params.createdBy ?? null,
    })
  }
  for (const subscriptionId of repriceIds) {
    await repriceSubscription(db, {
      tenantId,
      subscriptionId,
      createdBy: params.createdBy ?? null,
    })
  }

  return { updated }
}
