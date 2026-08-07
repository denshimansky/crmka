import { db } from "@/lib/db"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"
import { deactivateGroupEnrollmentOnWithdrawal } from "@/lib/subscriptions/deactivate-enrollment"
import { nextDayUtc } from "@/lib/subscriptions/last-paid-lesson-date"
import { netPaidToSubscription } from "@/lib/subscriptions/net-paid"
import { reconcileSubscriptionClosure } from "@/lib/subscriptions/reconcile-closure"
import { resolveAwaitingApplicationOnSubscriptionEnd } from "@/lib/subscriptions/resolve-awaiting-application"

/**
 * Закрывает все пакетные абонементы, у которых истёк срок (expiresAt < today).
 *
 * Денежная сверка при закрытии (единая формула — см. reconcile-closure.ts):
 *   - реальный ДОЛГ (ребёнок ходил, не доплатив: списано > оплачено) переносится
 *     на баланс родителя (минус) — иначе он «замерзал» на закрытом абонементе,
 *     который нельзя ни оплатить, ни отредактировать (баг ДЦ Первое Слово, 07.08.2026);
 *   - ПЕРЕПЛАТА/неиспользованный остаток пакета сгорает (burnOverpayment): на
 *     баланс не возвращаем, возврат — только вручную (UI ручного продления);
 *   - balance зануляется ВСЕГДА, чтобы закрытый пакет не висел «мёртвым» долгом
 *     (в т.ч. фантом неоплаченного неиспользованного пакета: delta=0 → balance→0).
 *
 * Lesson posting в attendance route уже фильтрует по expiresAt >= lessonDate,
 * так что после истечения новые списания невозможны. Этот cron нужен для
 * корректного status='closed', endDate и сверки долга/переплаты.
 *
 * Также по закрытым абонементам пересчитываем шаблонные linked-скидки клиента
 * — у других подопечных условие могло перестать выполняться.
 */
export async function closeExpiredPackages(now: Date = new Date()) {
  // Берём начало текущего дня (UTC) — пакет с expiresAt = вчера должен закрыться.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  // Сначала собираем кандидатов, чтобы потом дёрнуть recalculate по клиентам.
  const candidates = await db.subscription.findMany({
    where: {
      type: "package",
      status: { in: ["active", "pending"] },
      expiresAt: { lt: today },
      deletedAt: null,
    },
    select: {
      id: true,
      clientId: true,
      tenantId: true,
      groupId: true,
      wardId: true,
      directionId: true,
      status: true,
      activatedAt: true,
      expiresAt: true,
    },
  })
  if (candidates.length === 0) return { closed: 0 }

  // Валюта по тенантам — для символа в комментарии проводки долга.
  const tenantIds = [...new Set(candidates.map((c) => c.tenantId))]
  const orgs = await db.organization.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, currency: true },
  })
  const currencyByTenant = new Map(orgs.map((o) => [o.id, o.currency]))

  // Закрываем каждый пакет с денежной сверкой (реальный долг → на баланс родителя,
  // переплата сгорает, balance → 0). Пер-абонементная транзакция: проводка баланса
  // и update статуса атомарны.
  for (const c of candidates) {
    await db.$transaction(async (tx) => {
      await reconcileSubscriptionClosure(tx, {
        tenantId: c.tenantId,
        subscriptionId: c.id,
        clientId: c.clientId,
        directionId: c.directionId,
        employeeId: null,
        currency: currencyByTenant.get(c.tenantId),
        burnOverpayment: true,
      })
      await tx.subscription.update({
        where: { id: c.id },
        data: { status: "closed", endDate: today, balance: 0 },
      })
    })
  }

  // Баг #62: истёкший НЕОПЛАЧЕННЫЙ pending-пакет не должен оставлять заявку
  // висеть в «Ожидаем оплату» (guard'ы внутри резолвера: только pending и
  // никогда не активированный).
  for (const c of candidates) {
    if (c.status !== "pending" || c.activatedAt) continue
    try {
      await db.$transaction(async (tx) => {
        const netPaid = await netPaidToSubscription(tx, c.tenantId, c.id)
        await resolveAwaitingApplicationOnSubscriptionEnd(tx, {
          tenantId: c.tenantId,
          subscription: {
            id: c.id,
            clientId: c.clientId,
            wardId: c.wardId,
            directionId: c.directionId,
            status: c.status,
            activatedAt: c.activatedAt,
          },
          netPaid,
          employeeId: null,
          at: today,
        })
      })
    } catch (e) {
      console.error(`[cron:close-expired-packages] resolve application for ${c.id} failed`, e)
    }
  }

  // Ребёнок с истёкшим пакетом не должен висеть в будущем расписании:
  // деактивируем зачисление, если живых (pending/active) абонементов в группе
  // не осталось — guard внутри хелпера. Граница состава — expiresAt + 1
  // (пакет действовал по expiresAt включительно), а НЕ «последнее платное
  // занятие + 1»: иначе хвостовые «Не был»/«Уваж.» действовавшего пакета
  // удалялись бы чисткой, а пакет без единого платного визита стирал бы
  // ребёнка из всех прошлых составов (withdrawnAt=enrolledAt). Ручное
  // продление пакета (expiresAt, closed→active) симметрично реактивирует
  // зачисление (PATCH /subscriptions/[id]).
  for (const c of candidates) {
    await db.$transaction((tx) =>
      deactivateGroupEnrollmentOnWithdrawal(tx, {
        tenantId: c.tenantId,
        groupId: c.groupId,
        clientId: c.clientId,
        wardId: c.wardId,
        excludeSubscriptionId: c.id,
        scheduledBoundary: nextDayUtc(c.expiresAt ?? today),
      }),
    )
  }

  // Пересчёт шаблонных скидок — по каждому затронутому клиенту, в своей
  // мини-транзакции. Один клиент может фигурировать дважды → дедупликация.
  const seen = new Set<string>()
  for (const c of candidates) {
    const key = `${c.tenantId}:${c.clientId}`
    if (seen.has(key)) continue
    seen.add(key)
    await db.$transaction(async (tx) => {
      await recalcClientDiscounts(tx, {
        tenantId: c.tenantId,
        clientId: c.clientId,
        createdBy: null,
      })
    })
  }

  return { closed: candidates.length }
}
