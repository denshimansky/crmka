import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { netPaidToSubscription } from "@/lib/subscriptions/net-paid"
import { deactivateGroupEnrollmentOnWithdrawal } from "@/lib/subscriptions/deactivate-enrollment"
import { recalcClientDiscounts } from "@/lib/discounts/recalc-client-discounts"

/**
 * Авто-закрытие неоплаченных абонементов.
 *
 * Условия закрытия (для каждого тенанта с настройкой Organization.unpaidSubscriptionAutoCloseDays):
 *   1. Subscription.balance > 0 (есть долг — не оплачен полностью).
 *   2. Subscription.status IN ('pending', 'active').
 *   3. У абонемента нет ни одной записи Attendance (ребёнок не приходил).
 *   4. С даты startDate прошло >= N дней.
 *
 * Тип абонемента не фильтруется намеренно: неоплаченный и ни разу не
 * посещённый пакет тоже аннулируется с возвратом частичной оплаты —
 * в отличие от ИСТЕЧЕНИЯ срока пакета (close-expired-packages), где
 * остаток сгорает и возврат только вручную.
 *
 * Действия:
 *   — Денежная сверка как при ручном закрытии (Баг #4): посещений нет →
 *     выручки нет → долга быть не должно. Нетто-оплаченное возвращается на
 *     баланс родителя (subscription_closed_refund), Subscription.balance
 *     обнуляется — иначе «К оплате» висит долгом навсегда (карточка клиента,
 *     должники, виджет дашборда).
 *   — Subscription: status='closed', endDate=today, balance=0. endDate=today —
 *     намеренное отличие от ручного закрытия (последний день периода):
 *     аннулирование происходит «сейчас», а не по итогам месяца.
 *   — Связанные GroupEnrollment: isActive=false, withdrawnAt=today.
 *   — Если у клиента не осталось активных абонементов И были платежи в истории —
 *     перевод clientStatus в 'churned' с withdrawalDate=today.
 *
 * Каждый абонемент закрывается в отдельной транзакции с перепроверкой статуса
 * (защита от гонки с ручным закрытием/оплатой и от таймаута одной большой
 * транзакции на бэклоге). Ошибка по одному тенанту/клиенту не роняет cron.
 *
 * В конце — восстановление абонементов, закрытых этим cron'ом до фикса
 * (см. healAnnulledSubscriptions).
 *
 * Возвращает количество закрытых абонементов, клиентов, ушедших в churned,
 * и вылеченных исторических абонементов.
 */
export async function closeUnpaidSubscriptions(now: Date = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  const tenants = await db.organization.findMany({
    where: { unpaidSubscriptionAutoCloseDays: { not: null, gt: 0 } },
    select: { id: true, unpaidSubscriptionAutoCloseDays: true },
  })

  let closedSubs = 0
  let churnedClients = 0

  for (const t of tenants) {
    try {
      const days = t.unpaidSubscriptionAutoCloseDays!
      const threshold = new Date(today.getTime() - days * 24 * 60 * 60 * 1000)

      const candidates = await db.subscription.findMany({
        where: {
          tenantId: t.id,
          deletedAt: null,
          status: { in: ["pending", "active"] },
          balance: { gt: 0 },
          startDate: { lte: threshold },
          // Запланированное отчисление обслуживает finalize-scheduled-withdrawals.
          scheduledWithdrawalDate: null,
        },
        select: {
          id: true,
          clientId: true,
          wardId: true,
          groupId: true,
          directionId: true,
          _count: { select: { attendances: true } },
        },
      })

      const toClose = candidates.filter((s) => s._count.attendances === 0)
      if (toClose.length === 0) continue

      const closedClientIds = new Set<string>()
      for (const s of toClose) {
        const closed = await db.$transaction(async (tx) => {
          // Атомарный «клейм»: условный update вместо findFirst+update —
          // блокировка строки до конца транзакции закрывает гонку с ручным
          // закрытием/отчислением (сверка уже сделана) и с поздней оплатой.
          const claimed = await tx.subscription.updateMany({
            where: {
              id: s.id,
              tenantId: t.id,
              deletedAt: null,
              status: { in: ["pending", "active"] },
              balance: { gt: 0 },
            },
            data: { status: "closed", endDate: today, balance: 0 },
          })
          if (claimed.count === 0) return false

          await refundNetPaid(tx, { ...s, tenantId: t.id }, "Автозакрытие неоплаченного")

          // Ребёнок уходит из группы → исчезает из расписания. Но только если у
          // него не осталось другого живого (pending/active) абонемента в этой
          // же группе (helper). Заодно чиним scope: было wardId ?? undefined —
          // при wardId=null фильтр снимался и задевал чужие зачисления.
          await deactivateGroupEnrollmentOnWithdrawal(tx, {
            tenantId: t.id,
            groupId: s.groupId,
            clientId: s.clientId,
            wardId: s.wardId,
            excludeSubscriptionId: s.id,
          })
          return true
        })
        if (closed) {
          closedSubs++
          closedClientIds.add(s.clientId)
        }
      }

      // Пересчёт clientStatus + шаблонных скидок для каждого затронутого клиента.
      for (const clientId of closedClientIds) {
        try {
          const [activeSubsLeft, paymentsCount] = await Promise.all([
            db.subscription.count({
              where: { tenantId: t.id, clientId, status: "active", deletedAt: null },
            }),
            db.payment.count({ where: { tenantId: t.id, clientId } }),
          ])
          if (activeSubsLeft === 0 && paymentsCount > 0) {
            const res = await db.client.updateMany({
              where: {
                id: clientId,
                tenantId: t.id,
                clientStatus: "active",
              },
              data: { clientStatus: "churned", withdrawalDate: today },
            })
            churnedClients += res.count
          }
          // Скидки v2: закрытый без отметок аннулирован и выпадает из состава
          // месяца — пересчитываем скидки оставшихся абонементов клиента.
          await db.$transaction(async (tx) => {
            await recalcClientDiscounts(tx, {
              tenantId: t.id,
              clientId,
              createdBy: null,
            })
          })
        } catch (e) {
          console.error(`[cron:close-unpaid] client ${clientId} post-processing failed`, e)
        }
      }
    } catch (e) {
      console.error(`[cron:close-unpaid] tenant ${t.id} failed`, e)
    }
  }

  const healedSubs = await healAnnulledSubscriptions()

  return { closedSubs, churnedClients, healedSubs }
}

/**
 * Возврат нетто-оплаты аннулируемого абонемента на баланс родителя.
 *
 * Идемпотентно по данным: из суммы вычитаются уже сделанные при прошлых
 * закрытиях возвраты (subscription_closed_refund > 0 по этому абонементу) —
 * повторное закрытие после «воскрешения» balance (правка цены закрытого,
 * реактивация пакета) не возвращает те же деньги дважды.
 */
async function refundNetPaid(
  tx: Prisma.TransactionClient,
  s: { id: string; tenantId: string; clientId: string; directionId: string },
  commentPrefix: string,
): Promise<Prisma.Decimal> {
  const paid = await netPaidToSubscription(tx, s.tenantId, s.id)
  const priorAgg = await tx.clientBalanceTransaction.aggregate({
    where: {
      tenantId: s.tenantId,
      subscriptionId: s.id,
      type: "subscription_closed_refund",
      amount: { gt: 0 },
    },
    _sum: { amount: true },
  })
  const refundable = paid.minus(new Prisma.Decimal(priorAgg._sum.amount ?? 0))
  if (refundable.greaterThan(0)) {
    await applyBalanceDelta(tx, {
      tenantId: s.tenantId,
      clientId: s.clientId,
      delta: refundable,
      type: "subscription_closed_refund",
      refs: { subscriptionId: s.id, directionId: s.directionId },
      comment: `${commentPrefix}: возврат на баланс ${refundable.toFixed(2)} ₽`,
      createdBy: null,
    })
  }
  return refundable
}

/**
 * Восстановление сломанных закрытий (Баг #4): закрытый абонемент с balance > 0 —
 * «К оплате» висит долгом в карточке клиента, в должниках и в виджете
 * дашборда, хотя занятий не было и выручки нет. Источники: автозакрытие до
 * фикса и ручное закрытие старыми версиями кода (без денежной сверки) —
 * поэтому лечим по всем тенантам, без привязки к настройке автозакрытия.
 *
 * Критерии аннулированного: status='closed', есть «долг», ни одной отметки,
 * ни рубля списаний за занятия. Пакетные не лечим: close-expired-packages
 * намеренно оставляет долг («остаток сгорает, возврат — только вручную»).
 *
 * Сверка та же, что при закрытии: нетто-оплаченное (за вычетом уже сделанных
 * возвратов) — на баланс родителя, balance → 0. Идемпотентно, безопасно
 * выполняется при каждом запуске.
 */
async function healAnnulledSubscriptions(): Promise<number> {
  const broken = await db.subscription.findMany({
    where: {
      deletedAt: null,
      status: "closed",
      type: { not: "package" },
      balance: { gt: 0 },
      chargedAmount: { equals: 0 },
      attendances: { none: {} },
    },
    select: { id: true, tenantId: true, clientId: true, directionId: true },
  })

  let healed = 0
  for (const s of broken) {
    try {
      await db.$transaction(async (tx) => {
        await refundNetPaid(tx, s, "Аннулирование неоплаченного абонемента")
        await tx.subscription.update({
          where: { id: s.id },
          data: { balance: 0 },
        })
      })
      healed++
      console.info(`[cron:close-unpaid] healed annulled subscription ${s.id}`, {
        tenantId: s.tenantId,
        clientId: s.clientId,
      })
    } catch (e) {
      console.error(`[cron:close-unpaid] heal of subscription ${s.id} failed`, e)
    }
  }

  return healed
}
