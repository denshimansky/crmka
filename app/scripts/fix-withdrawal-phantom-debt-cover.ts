/**
 * Одноразовая корректировка денег (баг отчисления, найден 19.08.2026).
 *
 * PATCH /api/subscriptions/[id] при отчислении деактивировал зачисление ДО
 * subscription.update. Чистка «висящих» пустых отметок внутри деактивации зовёт
 * repriceSubscription, а тот пропускает только уже closed/withdrawn — абонемент
 * ещё числился active, поэтому пересчёт видел его живым на весь период,
 * насчитывал фантомный долг за неотходенные занятия и «покрывал» его с баланса
 * родителя (Payment transfer_in + ClientBalanceTransaction
 * transfer_to_subscription, комментарий «Автопокрытие долга с баланса
 * (пересчёт)»). В итоге часть только что возвращённых при отчислении денег
 * тут же уходила обратно в абонемент: у Ильясовой (ДЦ Dream) возврат 1950 ₽ и
 * сразу −650 ₽, абонемент выглядел оплаченным на 5 занятий вместо 4.
 *
 * Первопричина исправлена в коде (деактивация перенесена ПОСЛЕ update — тот же
 * порядок, что в /refund и closeSubscription). Здесь возвращаем деньги:
 *   1) сторно-платёж помечается deleted_at → «оплачено» абонемента (netPaid)
 *      падает на сумму автопокрытия, повторное закрытие не задвоит возврат;
 *   2) сумма возвращается на баланс родителя через applyBalanceDelta
 *      (type=correction) — с комментарием и снимком balance_after.
 *
 * Признак пострадавшей операции: transfer_to_subscription с комментарием
 * «Автопокрытие долга с баланса (пересчёт)», созданный В ТОЙ ЖЕ ТРАНЗАКЦИИ, что
 * и перевод абонемента в терминальный статус, — то есть abs(subscription.updatedAt
 * − cover.createdAt) ≤ 1 с при status ∈ (withdrawn, closed). На проде у всех
 * подтверждённых случаев разрыв 0.01–0.02 с, у легитимных покрытий — от 9 с и
 * больше (отдельный запрос до отчисления).
 *
 * Якорь по subscription_closed_refund («закрытие рядом») для отбора НЕ годится:
 * PATCH пишет эту проводку только при delta != 0 (route.ts, `if (!delta.isZero())`).
 * Если родитель заплатил ровно за отработанное, дельта нулевая, проводки нет —
 * а фантомное автопокрытие срабатывало всё равно, и такие случаи как раз самые
 * тяжёлые: у Кузивановой (ДЦ Dream) баг унёс ВЕСЬ возврат 2600 ₽, у Котылевской
 * 975 ₽. Первая версия скрипта их пропускала (найдено адверсариальным ревью).
 *
 * Idempotent: повторный прогон не найдёт кандидатов (платёж уже удалён).
 *
 * Запуск (из app/):
 *   node --import tsx scripts/fix-withdrawal-phantom-debt-cover.ts          # DRY-RUN (откат)
 *   node --import tsx scripts/fix-withdrawal-phantom-debt-cover.ts --apply  # APPLY
 * DATABASE_URL должен указывать на прод-БД (через SSH-туннель).
 */
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"

const APPLY = process.argv.includes("--apply")
/** Разрыв, при котором две записи гарантированно из ОДНОЙ транзакции, мс. */
const SAME_TXN_MS = 1000

class DryRunRollback extends Error {}

interface Candidate {
  txnId: string
  tenantId: string
  clientId: string
  clientName: string
  orgName: string
  subscriptionId: string
  paymentId: string | null
  amount: Prisma.Decimal
  at: Date
}

async function findCandidates(): Promise<Candidate[]> {
  const covers = await db.clientBalanceTransaction.findMany({
    where: {
      type: "transfer_to_subscription",
      comment: "Автопокрытие долга с баланса (пересчёт)",
      subscriptionId: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      clientId: true,
      subscriptionId: true,
      paymentId: true,
      amount: true,
      createdAt: true,
      client: { select: { firstName: true, lastName: true } },
      subscription: { select: { status: true, updatedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  const out: Candidate[] = []
  for (const c of covers) {
    const sub = c.subscription
    // Живой абонемент — покрытие легитимное (вариант A, симметрия пересчёта).
    if (!sub || (sub.status !== "withdrawn" && sub.status !== "closed")) continue
    // Та же транзакция, что и перевод в терминальный статус = баг. Покрытие,
    // случившееся отдельным запросом ДО отчисления, — норма: отчисление после
    // него корректно вернуло деньги (проверено на проде: Некрасова, Тутова,
    // Петаева — разрыв 9…173 с, деньги на месте).
    if (Math.abs(sub.updatedAt.getTime() - c.createdAt.getTime()) > SAME_TXN_MS) continue
    // Сторно уже сделано прошлым прогоном — пропускаем (идемпотентность).
    if (c.paymentId) {
      const pay = await db.payment.findUnique({
        where: { id: c.paymentId },
        select: { deletedAt: true },
      })
      if (pay?.deletedAt) continue
    } else {
      // Без платежа отменить покрытие идемпотентно нельзя: повторный прогон
      // задвоил бы возврат. Такого в данных нет (покрытие всегда создаёт
      // Payment), но молча не пропускаем — выводим на ручной разбор.
      console.warn(
        `  ! пропущено: транзакция ${c.id} (клиент ${c.clientId}) без payment_id — разобрать вручную`,
      )
      continue
    }
    const org = await db.organization.findUnique({
      where: { id: c.tenantId },
      select: { name: true },
    })
    out.push({
      txnId: c.id,
      tenantId: c.tenantId,
      clientId: c.clientId,
      clientName: `${c.client.lastName ?? ""} ${c.client.firstName}`.trim(),
      orgName: org?.name ?? c.tenantId,
      subscriptionId: c.subscriptionId!,
      paymentId: c.paymentId,
      // amount отрицательный (списание с баланса) — вернуть надо его модуль.
      amount: new Prisma.Decimal(c.amount).abs(),
      at: c.createdAt,
    })
  }
  return out
}

async function main() {
  const candidates = await findCandidates()
  console.log(`Найдено операций «автопокрытие внутри отчисления»: ${candidates.length}`)
  if (candidates.length === 0) {
    console.log("Корректировать нечего.")
    return
  }
  let total = new Prisma.Decimal(0)
  for (const c of candidates) {
    console.log(
      `  ${c.orgName} · ${c.clientName} · ${c.at.toISOString()} · ` +
        `вернуть ${c.amount.toFixed(2)} ₽ (абонемент ${c.subscriptionId})`,
    )
    total = total.plus(c.amount)
  }
  console.log(`Итого к возврату на балансы: ${total.toFixed(2)} ₽`)

  try {
    await db.$transaction(
      async (tx) => {
        for (const c of candidates) {
          if (c.paymentId) {
            await tx.payment.update({
              where: { id: c.paymentId },
              data: { deletedAt: new Date() },
            })
          }
          const res = await applyBalanceDelta(tx, {
            tenantId: c.tenantId,
            clientId: c.clientId,
            delta: c.amount,
            type: "correction",
            refs: { subscriptionId: c.subscriptionId },
            comment:
              "Исправление ошибки отчисления: отменено автопокрытие долга " +
              `${c.amount.toFixed(2)} ₽ (долга не было — абонемент отчислен)`,
            createdBy: null,
          })
          console.log(
            `  ✔ ${c.clientName}: баланс → ${res.newBalance.toFixed(2)} ₽`,
          )
        }
        if (!APPLY) throw new DryRunRollback()
      },
      { timeout: 120_000 },
    )
    console.log("APPLY: изменения зафиксированы.")
  } catch (e) {
    if (e instanceof DryRunRollback) {
      console.log("DRY-RUN: транзакция откатена, в БД ничего не изменено.")
      console.log("Для применения запустите с --apply")
    } else {
      throw e
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
