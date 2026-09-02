/**
 * Разовая корректировка SaaS-счёта ДЦ Dream №28-09 (найдено 01.09.2026).
 *
 * Что случилось. Крон billing-generate-invoices выставил счёт за сентябрь
 * 20.08.2026, когда у партнёра было 3 филиала → 12 500 ₽ по сетке «Стандарт».
 * 31.08.2026 филиал «Панорама» удалён: syncSubscriptionBranchCount подтянул
 * подписку (branchCount 3→2, monthlyAmount 12500→9000), но УЖЕ ВЫСТАВЛЕННЫЙ
 * счёт за ещё не начавшийся период не пересчитывается — такой ветки в коде нет.
 * Партнёр заплатил правильные 9 000 ₽; матчер выписки (правило inn_amount)
 * по сумме не сошёлся и положил операцию в «Неразобранные».
 *
 * Здесь приводим счёт к фактическому составу филиалов и закрываем его оплатой:
 *   1) счёт 28-09: amount 12500 → 9000, branchCount 3 → 2, comment пересобран;
 *   2) applyInvoicePayment — штатный хелпер: счёт → paid, подписка продлевается
 *      (periodEndDate 30.09, nextPaymentDate 01.10), blockedAt → null,
 *      уведомления «оплатите счёт» удаляются;
 *   3) операция выписки d771e459 → matched со ссылкой на счёт (уходит из
 *      «Неразобранных платежей»).
 *
 * Idempotent: повторный прогон увидит счёт в статусе paid и остановится.
 *
 * Запуск (из app/, DATABASE_URL — прод через SSH-туннель):
 *   npx tsx scripts/fix-dream-invoice-28-09.ts           # DRY-RUN (откат)
 *   APPLY=1 npx tsx scripts/fix-dream-invoice-28-09.ts   # APPLY
 */
import { db } from "@/lib/db"
import { monthlyPriceFor } from "@/lib/billing-price"
import { applyInvoicePayment } from "@/lib/billing/apply-invoice-payment"

const APPLY = process.env.APPLY === "1" || process.argv.includes("--apply")

const ORG_ID = "ac1849e2-daa5-45e2-91ea-774d643f1ba6"
const INVOICE_NUMBER = "28-09"
const BANK_OP_ROW_ID = "d771e459-07ce-4dc4-83df-7fd60f592bef"

class DryRunRollback extends Error {}

const money = (v: unknown) => Number(v).toLocaleString("ru-RU")
const dt = (v: Date | null | undefined) =>
  v ? v.toISOString().slice(0, 19).replace("T", " ") : "—"
const day = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "—")

async function main() {
  const invoice = await db.billingInvoice.findFirst({
    where: { organizationId: ORG_ID, number: INVOICE_NUMBER },
    include: {
      subscription: { include: { plan: true } },
      organization: { select: { name: true, inn: true, billingStatus: true } },
    },
  })
  if (!invoice) throw new Error(`Счёт ${INVOICE_NUMBER} у организации ${ORG_ID} не найден`)

  const op = await db.billingBankOperation.findUnique({ where: { id: BANK_OP_ROW_ID } })
  if (!op) throw new Error(`Операция выписки ${BANK_OP_ROW_ID} не найдена`)

  const sub = invoice.subscription
  const expected = monthlyPriceFor(sub.plan, sub.branchCount) * (invoice.periodMonths || 1)
  const opAmount = Number(op.amount)

  console.log("=== BEFORE ===")
  console.log(
    `Организация:   ${invoice.organization.name} (ИНН ${invoice.organization.inn}), billingStatus=${invoice.organization.billingStatus}`
  )
  console.log(
    `Счёт ${invoice.number}: ${money(invoice.amount)} ₽, филиалов ${invoice.branchCount}, ${invoice.periodMonths} мес., статус ${invoice.status}`
  )
  console.log(
    `  период ${day(invoice.periodStart)}–${day(invoice.periodEnd)}, срок ${day(invoice.dueDate)}, кредит применён ${money(invoice.creditApplied)} ₽`
  )
  console.log(`  комментарий: ${invoice.comment}`)
  console.log(
    `Подписка: план «${sub.plan.name}», филиалов ${sub.branchCount}, ${money(sub.monthlyAmount)} ₽/мес, статус ${sub.status}`
  )
  console.log(
    `  periodEndDate=${day(sub.periodEndDate)}, nextPaymentDate=${day(sub.nextPaymentDate)}, blockedAt=${dt(sub.blockedAt)}, кредит=${money(sub.creditBalance)} ₽`
  )
  console.log(`Операция выписки: ${money(op.amount)} ₽ от ${dt(op.operationDate)}, статус ${op.status}`)
  console.log(`  причина: ${op.comment}`)
  console.log(
    `Ожидаемая цена по сетке для ${sub.branchCount} фил. × ${invoice.periodMonths} мес: ${money(expected)} ₽`
  )

  // --- Гарды: правим только то, что действительно расходится ---
  if (invoice.status === "paid") throw new Error("Счёт уже оплачен — фикс не нужен (idempotent stop)")
  if (invoice.status !== "overdue" && invoice.status !== "pending") {
    throw new Error(`Неожиданный статус счёта: ${invoice.status}`)
  }
  if (invoice.isAdjustment) throw new Error("Счёт доплатный (isAdjustment) — не тот случай")
  if (Number(invoice.creditApplied) !== 0) {
    throw new Error(
      `В счёте учтён кредит ${money(invoice.creditApplied)} ₽ — нужен ручной разбор возврата кредита`
    )
  }
  if (expected !== opAmount) {
    throw new Error(
      `Цена по сетке (${money(expected)} ₽) не равна сумме платежа (${money(opAmount)} ₽) — остановка`
    )
  }
  if (Number(invoice.amount) === expected) throw new Error("Сумма счёта уже верна — фикс не нужен")
  if (op.status !== "unmatched") throw new Error(`Операция выписки уже в статусе ${op.status}`)
  if (op.payerInn !== invoice.organization.inn) {
    throw new Error(
      `ИНН плательщика (${op.payerInn}) не совпадает с ИНН организации (${invoice.organization.inn})`
    )
  }

  const newComment = `SaaS «Умная CRM», ${sub.branchCount} фил. × ${invoice.periodMonths} мес.`
  const payComment = `Оплачен по выписке Т-Банк, операция ${op.operationId} от ${day(op.operationDate)}`

  try {
    await db.$transaction(async (tx) => {
      // 1. Счёт приводим к фактическому числу филиалов
      await tx.billingInvoice.update({
        where: { id: invoice.id },
        data: { amount: expected, branchCount: sub.branchCount, comment: newComment },
      })

      // 2. Штатное «счёт оплачен»: paid + продление подписки + разблокировка
      const res = await applyInvoicePayment(tx, {
        invoiceId: invoice.id,
        paidVia: "bank_transfer",
        paidAmount: opAmount,
        paidAt: op.operationDate,
        comment: payComment,
      })
      console.log(`\napplyInvoicePayment: applied=${res.applied}, unblocked=${res.unblocked}`)

      // 3. Операция выписки — разобрана
      await tx.billingBankOperation.update({
        where: { id: op.id },
        data: {
          status: "matched",
          matchedInvoiceIds: [invoice.id],
          comment: `Разобран вручную 01.09.2026: филиал удалён 31.08 после выставления счёта, счёт пересчитан 12500 → ${expected} ₽ (${sub.branchCount} фил.)`,
        },
      })

      // --- AFTER (внутри транзакции, чтобы видеть результат и в dry-run) ---
      const invAfter = await tx.billingInvoice.findUnique({ where: { id: invoice.id } })
      const subAfter = await tx.billingSubscription.findUnique({ where: { id: sub.id } })
      const orgAfter = await tx.organization.findUnique({
        where: { id: ORG_ID },
        select: { billingStatus: true },
      })
      const opAfter = await tx.billingBankOperation.findUnique({ where: { id: op.id } })

      console.log("\n=== AFTER ===")
      console.log(
        `Счёт ${invAfter!.number}: ${money(invAfter!.amount)} ₽, филиалов ${invAfter!.branchCount}, статус ${invAfter!.status}`
      )
      console.log(
        `  оплачено ${money(invAfter!.paidAmount)} ₽ через ${invAfter!.paidVia} от ${dt(invAfter!.paidAt)}`
      )
      console.log(`  комментарий: ${invAfter!.comment}`)
      console.log(
        `Подписка: статус ${subAfter!.status}, periodEndDate=${day(subAfter!.periodEndDate)}, nextPaymentDate=${day(subAfter!.nextPaymentDate)}, blockedAt=${dt(subAfter!.blockedAt)}`
      )
      console.log(`Организация: billingStatus=${orgAfter!.billingStatus}`)
      console.log(
        `Операция выписки: статус ${opAfter!.status}, привязана к счетам ${JSON.stringify(opAfter!.matchedInvoiceIds)}`
      )

      if (!APPLY) throw new DryRunRollback()
    })
    console.log("\n✅ APPLY: изменения зафиксированы")
  } catch (e) {
    if (e instanceof DryRunRollback) {
      console.log("\n🔍 DRY-RUN: транзакция откачена, в БД ничего не изменилось. Для применения: APPLY=1")
      return
    }
    throw e
  }
}

main()
  .catch((e) => {
    console.error("❌", e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
