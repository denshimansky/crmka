// Пересчёт календарного абонемента под дату отложенного отчисления (Подход A).
//
// Проблема: при планировании отчисления на дату X абонемент оставался с полной
// месячной стоимостью до самой финализации (cron X+1). Всё это время система
// «просила» полную сумму: balance в списках/должниках/напоминаниях показывал
// долг за занятия ПОСЛЕ X, которых ребёнок уже не посетит. Деньги в итоге
// сходились (сверка на X+1 возвращает лишнее), но интерфейс 2 недели пугал
// родителя фантомным долгом.
//
// Решение: при планировании отчисления totalLessons приводится к реальному
// числу неотменённых занятий группы от начала абонемента по дату X включительно,
// затем finalAmount/balance выравнивает repriceSubscription (та же цепочка, что
// при ручной правке количества занятий в PATCH). При отмене плана — обратный
// пересчёт на полный период. Финальная сверка (X+1) считает по фактическим
// списаниям и от totalLessons не зависит — менять её не нужно.

import { Prisma, type PrismaClient } from "@prisma/client"
import { repriceSubscription } from "@/lib/discounts/recalc-client-discounts"
import { subscriptionPeriodEnd } from "./last-paid-lesson-date"

type Tx = Prisma.TransactionClient | PrismaClient

export interface ProratableSubscription {
  id: string
  groupId: string
  type: string
  status: string
  startDate: Date | null
  endDate: Date | null
  periodYear: number | null
  periodMonth: number | null
  expiresAt?: Date | null
  totalLessons: number
  lessonPrice: Prisma.Decimal | number
  discountAmount: Prisma.Decimal | number
  discountSource: string
}

/**
 * Диапазон занятий, которые покрывает календарный абонемент с учётом даты
 * отчисления `until` (включительно). `until=null` — полный период (для отмены
 * запланированного отчисления). null-результат — пересчёт не применим:
 * не календарный тип (у пакета totalLessons — купленное количество, а не план
 * месяца), нет периода, либо диапазон пуст.
 */
export function prorationRange(
  sub: {
    type: string
    startDate: Date | null
    endDate: Date | null
    periodYear: number | null
    periodMonth: number | null
    expiresAt?: Date | null
  },
  until: Date | null,
): { from: Date; to: Date } | null {
  if (sub.type !== "calendar") return null
  if (!sub.periodYear || !sub.periodMonth) return null
  const periodStart = new Date(Date.UTC(sub.periodYear, sub.periodMonth - 1, 1))
  const from = sub.startDate && sub.startDate > periodStart ? sub.startDate : periodStart
  const periodEnd = subscriptionPeriodEnd(sub)
  let toDay = until ?? periodEnd
  if (toDay > periodEnd) toDay = periodEnd
  // Конец дня X: Lesson.date хранит дату-время начала занятия.
  const to = new Date(
    Date.UTC(toDay.getUTCFullYear(), toDay.getUTCMonth(), toDay.getUTCDate(), 23, 59, 59),
  )
  if (to < from) return null
  return { from, to }
}

/**
 * Пересчитывает totalLessons/totalAmount/finalAmount/balance абонемента по
 * реальным неотменённым занятиям группы в диапазоне prorationRange. Если
 * занятий в диапазоне нет (расписание периода не сгенерировано) или число не
 * изменилось — деньги не трогаем. Legacy-скидка пересчитывается той же
 * формулой, что и PATCH при правке цены; остальным — repriceSubscription.
 */
export async function prorateScheduledWithdrawal(
  tx: Tx,
  params: {
    tenantId: string
    subscription: ProratableSubscription
    /** Дата отчисления X (занятия по X включительно) или null — полный период. */
    until: Date | null
    createdBy: string | null
  },
): Promise<{ changed: boolean; totalLessons: number }> {
  const sub = params.subscription
  // Только живые: у закрытого/отчисленного balance выставлен сверкой закрытия —
  // пересчёт перетёр бы его (repriceSubscription держит тот же guard).
  if (sub.status !== "pending" && sub.status !== "active") {
    return { changed: false, totalLessons: sub.totalLessons }
  }
  const range = prorationRange(sub, params.until)
  if (!range) return { changed: false, totalLessons: sub.totalLessons }

  const planned = await tx.lesson.count({
    where: {
      tenantId: params.tenantId,
      groupId: sub.groupId,
      status: { not: "cancelled" },
      date: { gte: range.from, lte: range.to },
    },
  })
  if (planned === 0 || planned === sub.totalLessons) {
    return { changed: false, totalLessons: sub.totalLessons }
  }

  const lessonPrice = Number(sub.lessonPrice)
  const totalAmount = lessonPrice * planned
  const updateData: {
    totalLessons: number
    totalAmount: number
    finalAmount?: number
    balance?: number
  } = { totalLessons: planned, totalAmount }

  if (sub.discountSource === "legacy") {
    // Легаси: скидка заморожена в рублях — формула из PATCH (правка цены/занятий).
    const finalAmount = totalAmount - Number(sub.discountAmount)
    const paidSum = await tx.payment.aggregate({
      where: { tenantId: params.tenantId, subscriptionId: sub.id, deletedAt: null },
      _sum: { amount: true },
    })
    updateData.finalAmount = finalAmount
    updateData.balance = finalAmount - Number(paidSum._sum.amount || 0)
  }

  await tx.subscription.update({ where: { id: sub.id }, data: updateData })

  if (sub.discountSource !== "legacy") {
    await repriceSubscription(tx, {
      tenantId: params.tenantId,
      subscriptionId: sub.id,
      createdBy: params.createdBy,
    })
  }

  return { changed: true, totalLessons: planned }
}
