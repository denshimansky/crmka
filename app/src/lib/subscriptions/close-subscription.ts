import { Prisma } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { netPaidToSubscription } from "@/lib/subscriptions/net-paid"
import { deactivateGroupEnrollmentOnWithdrawal } from "@/lib/subscriptions/deactivate-enrollment"
import { resolveAwaitingApplicationOnSubscriptionEnd } from "@/lib/subscriptions/resolve-awaiting-application"
import { nextDayUtc } from "@/lib/subscriptions/last-paid-lesson-date"

type Tx = Prisma.TransactionClient

export interface CloseSubscriptionInput {
  tenantId: string
  subscriptionId: string
  employeeId?: string | null
  /**
   * endDate абонемента. Если не передан — последний день периода (календарный)
   * или сегодня (пакет без периода). Крон и PATCH считают его одинаково.
   */
  endDate?: Date
}

export interface CloseSubscriptionResult {
  closed: boolean
  /** Знаковая дельта баланса: + возврат родителю, − долг. 0 — без движения. */
  balanceDelta: number
  enrollmentsDeactivated: number
}

/**
 * Штатное закрытие абонемента (период истёк, занятия отработаны) с денежной
 * сверкой и записью в историю клиента. Единая точка для:
 *   - cron close-finished-calendar-subscriptions (авто-закрытие);
 *   - PATCH /api/subscriptions/[id] status=closed (программный путь).
 *
 * Почему сверка обязана быть ЗДЕСЬ, а не только в reprice при отметке:
 *   reprice возвращает переплату за прощённые занятия (Уваж. пропуск/Перерасчёт)
 *   в момент отметки — но только для живых НЕ-legacy абонементов и только если
 *   отметка прошла через актуальный код. Если этого не случилось (отметки до
 *   код-фикса 07.07.2026, legacy-абонемент, импорт), finalAmount/balance не
 *   отражают прощённые занятия, и раньше крон молча закрывал переплаченный
 *   абонемент, «съедая» переплату (баг карточки Лескиной, июнь 2026: 8 занятий,
 *   3 «Уваж. пропуск», 1350 ₽ не вернулись на баланс).
 *
 * Сверка: delta = оплачено(net) − списано − уже применённые возвраты закрытия.
 *   + > 0 → переплата возвращается на баланс родителя (subscription_closed_refund);
 *   − < 0 → долг (клиент ходил, не доплатив) — уходит в минус баланса;
 *   вычитание прошлых subscription_closed_refund делает повторное закрытие/
 *   реактивацию безопасным (деньги не двигаются дважды).
 *   Для корректно пересчитанного reprice-абонемента net-оплачено уже уменьшено
 *   сторно-платежами → delta = 0, двойного возврата нет.
 *
 * Идемпотентность: уже closed/withdrawn абонемент не трогаем (return closed=false).
 *
 * Всё выполняется в переданной транзакции `tx` — вызывающий отвечает за неё.
 */
export async function closeSubscription(
  tx: Tx,
  input: CloseSubscriptionInput,
): Promise<CloseSubscriptionResult> {
  const existing = await tx.subscription.findFirst({
    where: { id: input.subscriptionId, tenantId: input.tenantId, deletedAt: null },
    include: { direction: { select: { name: true } } },
  })
  if (!existing) return { closed: false, balanceDelta: 0, enrollmentsDeactivated: 0 }
  // Уже завершённый абонемент повторно не сверяем: balance выставлен закрытием,
  // возврат двигать второй раз нельзя.
  if (existing.status === "closed" || existing.status === "withdrawn") {
    return { closed: false, balanceDelta: 0, enrollmentsDeactivated: 0 }
  }

  // endDate = последний день периода (для абонемента без периода — сегодня).
  const endDate =
    input.endDate ??
    (existing.periodYear && existing.periodMonth
      ? new Date(Date.UTC(existing.periodYear, existing.periodMonth, 0))
      : new Date())

  // ── Денежная сверка (net-оплачено − списано − прошлые возвраты закрытия) ──
  const paidToSub = await netPaidToSubscription(tx, input.tenantId, existing.id)
  const usedAgg = await tx.attendance.aggregate({
    where: { tenantId: input.tenantId, subscriptionId: existing.id },
    _sum: { chargeAmount: true },
  })
  const usedAmount = new Prisma.Decimal(usedAgg._sum.chargeAmount ?? 0)
  const priorAgg = await tx.clientBalanceTransaction.aggregate({
    where: {
      tenantId: input.tenantId,
      subscriptionId: existing.id,
      type: "subscription_closed_refund",
    },
    _sum: { amount: true },
  })
  const delta = paidToSub
    .minus(usedAmount)
    .minus(new Prisma.Decimal(priorAgg._sum.amount ?? 0))

  if (!delta.isZero()) {
    await applyBalanceDelta(tx, {
      tenantId: input.tenantId,
      clientId: existing.clientId,
      delta,
      type: "subscription_closed_refund",
      refs: { subscriptionId: existing.id, directionId: existing.directionId },
      comment: delta.isPositive()
        ? `Закрытие: возврат на баланс ${delta.toFixed(2)} ₽`
        : `Закрытие: долг ${delta.abs().toFixed(2)} ₽`,
      createdBy: input.employeeId ?? null,
    })
  }

  // Заявка «Ожидаем оплату» по неактивированному pending не должна зависнуть
  // (для active-абонемента — no-op, guard внутри). Считаем ДО update, как в PATCH.
  await resolveAwaitingApplicationOnSubscriptionEnd(tx, {
    tenantId: input.tenantId,
    subscription: {
      id: existing.id,
      clientId: existing.clientId,
      wardId: existing.wardId,
      directionId: existing.directionId,
      status: existing.status,
      activatedAt: existing.activatedAt,
    },
    netPaid: paidToSub,
    employeeId: input.employeeId ?? null,
  })

  await tx.subscription.update({
    where: { id: existing.id },
    data: { status: "closed", endDate, balance: 0 },
  })

  // ── Строка в историю клиента (пункт заказчика: видеть закрытие в карточке) ──
  const period =
    existing.periodMonth && existing.periodYear
      ? ` (${String(existing.periodMonth).padStart(2, "0")}.${existing.periodYear})`
      : ""
  const moneyNote = delta.isZero()
    ? "Баланс без изменений."
    : delta.isPositive()
      ? `Возврат на баланс родителя: ${delta.toFixed(2)} ₽.`
      : `Образовался долг: ${delta.abs().toFixed(2)} ₽.`
  await tx.communication.create({
    data: {
      tenantId: input.tenantId,
      clientId: existing.clientId,
      type: "note",
      channel: "internal",
      direction: "internal",
      content: `Абонемент «${existing.direction.name}»${period} закрыт. ${moneyNote}`,
      employeeId: input.employeeId ?? undefined,
    },
  })

  // Зачисление деактивируем, если у ребёнка не осталось другого живого абонемента
  // в группе (guard внутри). Граница состава = конец периода + 1 (месяц штатно
  // отработан — ребёнок легитимно в составе до конца периода). Строго ПОСЛЕ
  // update, чтобы reprice внутри чистки пустых отметок видел абонемент уже closed.
  const enrollmentsDeactivated = await deactivateGroupEnrollmentOnWithdrawal(tx, {
    tenantId: input.tenantId,
    groupId: existing.groupId,
    clientId: existing.clientId,
    wardId: existing.wardId,
    excludeSubscriptionId: existing.id,
    scheduledBoundary: nextDayUtc(endDate),
  })

  return { closed: true, balanceDelta: delta.toNumber(), enrollmentsDeactivated }
}
