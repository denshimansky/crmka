/**
 * Backfill Client.clientBalance и ClientBalanceTransaction
 * по новой модели Ф2 (deploy 2026-05-25).
 *
 * Старые абонементы (созданные до Ф2/C1) не порождали транзакцию
 * subscription_issued, а оплаты — payment_received. Из-за этого
 * clientBalance показывал «сальдо счёта», а не «долг клиента».
 *
 * Скрипт:
 *   1. Для каждого тенанта берём всех клиентов (включая soft-deleted).
 *   2. Обнуляем clientBalance и удаляем все ClientBalanceTransaction клиента.
 *   3. Собираем хронологию событий: Payment (incoming/refund) и Subscription
 *      (по createdAt). Прогоняем через applyBalanceDelta.
 *   4. Логируем итог по тенанту.
 *
 * Запуск (на сервере, в контейнере app):
 *     docker compose exec app npx tsx prisma/scripts/backfill-client-balances.ts
 *
 * Безопасный, идемпотентный: можно перезапускать сколько угодно — каждый раз
 * пересчитывает с нуля по фактам в БД.
 *
 * НЕ запускается автоматически миграцией Prisma.
 */
import { PrismaClient, Prisma } from "@prisma/client"
import type { BalanceTransactionType } from "@prisma/client"

const db = new PrismaClient()

// Inline-копия applyBalanceDelta — скрипт запускается в контейнере app, где
// src/lib не присутствует (Next.js standalone ships only compiled output).
// Логика 1-в-1 совпадает с src/lib/balance/transactions.ts:applyBalanceDelta.
async function applyBalanceDelta(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string
    clientId: string
    delta: Prisma.Decimal | number | string
    type: BalanceTransactionType
    refs?: {
      subscriptionId?: string | null
      paymentId?: string | null
      lessonId?: string | null
      directionId?: string | null
      attendanceId?: string | null
    }
    comment?: string
    createdBy?: string | null
  },
) {
  const delta = new Prisma.Decimal(input.delta)
  const updated = await tx.client.update({
    where: { id: input.clientId },
    data: { clientBalance: { increment: delta } },
    select: { clientBalance: true },
  })
  await tx.clientBalanceTransaction.create({
    data: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      type: input.type,
      amount: delta,
      balanceAfter: updated.clientBalance,
      subscriptionId: input.refs?.subscriptionId ?? null,
      paymentId: input.refs?.paymentId ?? null,
      lessonId: input.refs?.lessonId ?? null,
      directionId: input.refs?.directionId ?? null,
      attendanceId: input.refs?.attendanceId ?? null,
      comment: input.comment,
      createdBy: input.createdBy ?? null,
    },
    select: { id: true },
  })
}

type Event =
  | { kind: "payment"; date: Date; paymentId: string; subscriptionId: string | null; amount: Prisma.Decimal; type: "incoming" | "refund" | "transfer_in" }
  | { kind: "subscription"; date: Date; subscriptionId: string; directionId: string; finalAmount: Prisma.Decimal }

async function backfillTenant(tenantId: string) {
  const clients = await db.client.findMany({
    where: { tenantId },
    select: { id: true, firstName: true, lastName: true },
  })

  console.log(`\n=== Tenant ${tenantId}: ${clients.length} клиентов ===`)

  let totalClients = 0
  let totalTransactions = 0

  for (const client of clients) {
    const payments = await db.payment.findMany({
      where: { tenantId, clientId: client.id, deletedAt: null },
      select: { id: true, date: true, amount: true, type: true, subscriptionId: true },
      orderBy: { date: "asc" },
    })

    const subscriptions = await db.subscription.findMany({
      where: { tenantId, clientId: client.id, deletedAt: null },
      select: { id: true, createdAt: true, finalAmount: true, directionId: true },
      orderBy: { createdAt: "asc" },
    })

    if (payments.length === 0 && subscriptions.length === 0) {
      continue
    }

    const events: Event[] = []
    for (const p of payments) {
      events.push({
        kind: "payment",
        date: p.date,
        paymentId: p.id,
        subscriptionId: p.subscriptionId,
        amount: p.amount,
        type: p.type as "incoming" | "refund" | "transfer_in",
      })
    }
    for (const s of subscriptions) {
      events.push({
        kind: "subscription",
        date: s.createdAt,
        subscriptionId: s.id,
        directionId: s.directionId,
        finalAmount: s.finalAmount,
      })
    }
    events.sort((a, b) => a.date.getTime() - b.date.getTime())

    await db.$transaction(async (tx) => {
      await tx.clientBalanceTransaction.deleteMany({ where: { tenantId, clientId: client.id } })
      await tx.client.update({ where: { id: client.id }, data: { clientBalance: 0 } })

      for (const ev of events) {
        if (ev.kind === "subscription") {
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: client.id,
            delta: new Prisma.Decimal(ev.finalAmount).negated(),
            type: "subscription_issued",
            refs: { subscriptionId: ev.subscriptionId, directionId: ev.directionId },
            comment: "backfill",
          })
          totalTransactions++
        } else {
          // type=incoming → +amount (payment_received)
          // type=refund   → -|amount| (refund) — старый Payment refund, реально деньги ушли клиенту
          // type=transfer_in → +amount (transfer_to_subscription, для совместимости)
          let txType: "payment_received" | "refund" | "transfer_to_subscription"
          let delta: Prisma.Decimal
          if (ev.type === "refund") {
            txType = "refund"
            delta = new Prisma.Decimal(ev.amount) // amount уже отрицательный для refund
          } else if (ev.type === "transfer_in") {
            txType = "transfer_to_subscription"
            delta = new Prisma.Decimal(ev.amount)
          } else {
            txType = "payment_received"
            delta = new Prisma.Decimal(ev.amount)
          }
          await applyBalanceDelta(tx, {
            tenantId,
            clientId: client.id,
            delta,
            type: txType,
            refs: { paymentId: ev.paymentId, subscriptionId: ev.subscriptionId },
            comment: "backfill",
          })
          totalTransactions++
        }
      }
    })

    totalClients++
    if (totalClients % 50 === 0) {
      console.log(`  ...обработано ${totalClients}/${clients.length} клиентов`)
    }
  }

  const aggBalance = await db.client.aggregate({
    where: { tenantId },
    _sum: { clientBalance: true },
  })
  console.log(`Готово: ${totalClients} клиентов, ${totalTransactions} транзакций, итоговый совокупный баланс ${aggBalance._sum.clientBalance ?? 0}₽`)
}

async function main() {
  const tenants = await db.organization.findMany({ select: { id: true, name: true } })
  console.log(`Найдено ${tenants.length} тенантов`)
  for (const t of tenants) {
    console.log(`\n>>> ${t.name} (${t.id})`)
    await backfillTenant(t.id)
  }
  console.log("\nBackfill завершён.")
}

main()
  .catch((err) => {
    console.error("Ошибка:", err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
