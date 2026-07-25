import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { monthlyPriceFor } from "@/lib/billing-price"
import { computeBranchProration, selectProrationBase } from "@/lib/billing/branch-proration"
import { nextInvoiceNumber } from "@/lib/billing/invoice-number"
import { applyInvoicePayment } from "@/lib/billing/apply-invoice-payment"

// SaaS-подписка тарифицируется по числу филиалов: после создания/удаления
// филиала подтягиваем branchCount подписки к фактическому числу активных
// филиалов и пересчитываем месячную цену по сетке тарифа.
// Организация без филиалов платит как за один.
//
// Если смена произошла ВНУТРИ уже оплаченного многомесячного периода (3/6/12
// мес), делаем пропорциональный перерасчёт за остаток периода (по дням):
//   • рост цены  → доплатный счёт (pending, срок +10 дней), уведомление;
//   • снижение   → кредит организации (credit_balance), гасящий следующий счёт.
// Каждый перерасчёт фиксируется в billing_adjustments (аудит). Помесячная оплата
// (1 мес) и не-оплаченные периоды (тест/блок) перерасчётом не затрагиваются —
// новая цена подхватится ближайшим счётом сама (computeBranchProration → null).

const DAY_MS = 24 * 60 * 60 * 1000
const CHARGE_DUE_DAYS = 10 // срок оплаты доплатного счёта

const round2 = (n: number) => Math.round(n * 100) / 100

const utcMidnight = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

const fmtDate = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`

const rub = (n: number) => n.toLocaleString("ru-RU")

export async function syncSubscriptionBranchCount(tenantId: string, now: Date = new Date()) {
  const actual = await db.branch.count({ where: { tenantId, deletedAt: null } })
  const branchCount = Math.max(1, actual)

  const subscription = await db.billingSubscription.findFirst({
    where: { organizationId: tenantId, status: { not: "cancelled" } },
    orderBy: { createdAt: "desc" },
    include: {
      plan: true,
      organization: { select: { billingExempt: true } },
    },
  })
  if (!subscription || subscription.branchCount === branchCount) return

  const oldBranchCount = subscription.branchCount
  const oldMonthly = Number(subscription.monthlyAmount)
  const newMonthly = monthlyPriceFor(subscription.plan, branchCount)

  // Подписка всегда подтягивается к фактическому составу (даже без перерасчёта).
  const subData = { branchCount, monthlyAmount: newMonthly }

  // Перерасчёт — только для платящих орг и только если есть оплаченный период,
  // идущий прямо сейчас (periodStart ≤ сегодня ≤ periodEnd). Базу выбираем
  // чистой selectProrationBase: только периодный счёт (isAdjustment=false),
  // доплатные счета как база дали бы неверный totalDays при телескопировании.
  const today = utcMidnight(now)
  const coveringPaid = subscription.organization.billingExempt
    ? []
    : await db.billingInvoice.findMany({
        where: {
          subscriptionId: subscription.id,
          status: "paid",
          periodStart: { lte: today },
          periodEnd: { gte: today },
        },
      })
  const paidInvoice = selectProrationBase(coveringPaid, today)

  const proration = paidInvoice
    ? computeBranchProration({
        periodMonths: paidInvoice.periodMonths,
        oldMonthly,
        newMonthly,
        periodStart: paidInvoice.periodStart,
        periodEnd: paidInvoice.periodEnd,
        changeDate: today,
      })
    : null

  if (!proration) {
    await db.billingSubscription.update({ where: { id: subscription.id }, data: subData })
    return
  }

  const recipients = await db.employee.findMany({
    where: { tenantId, isActive: true, deletedAt: null, role: { in: ["owner", "manager"] } },
    select: { id: true },
  })

  const auditBase = {
    subscriptionId: subscription.id,
    organizationId: tenantId,
    oldBranchCount,
    newBranchCount: branchCount,
    oldMonthly,
    newMonthly,
    periodStart: paidInvoice!.periodStart,
    periodEnd: paidInvoice!.periodEnd,
    remainingDays: proration.remainingDays,
    totalDays: proration.totalDays,
    amount: proration.amount,
  }

  // Снижение цены → кредит организации (гасит следующий счёт). Счёт не создаём.
  if (proration.kind === "credit") {
    await db.$transaction(async (tx) => {
      await tx.billingSubscription.update({
        where: { id: subscription.id },
        data: { ...subData, creditBalance: { increment: proration.amount } },
      })
      await tx.billingAdjustment.create({ data: { ...auditBase, kind: "credit" } })
      if (recipients.length) {
        await tx.notification.createMany({
          data: recipients.map((r) => ({
            tenantId,
            employeeId: r.id,
            type: "billing_credit" as const,
            title: `Кредит ${rub(proration.amount)} ₽ за уменьшение филиалов`,
            message: `Филиалов стало ${oldBranchCount} → ${branchCount}. Кредит за остаток оплаченного периода (${proration.remainingDays} из ${proration.totalDays} дн.) зачтётся в следующий счёт.`,
          })),
        })
      }
    })
    return
  }

  // Рост цены → доплатный счёт за остаток периода. Существующий кредит
  // организации сначала неттим против доплаты (как в генераторе регулярных
  // счетов), остаток кредита переносится. Номер уникален — гонку по
  // unique(number) разрешаем ретраем.
  const creditAvailable = Number(subscription.creditBalance || 0)
  const creditApplied = round2(Math.min(creditAvailable, proration.amount))
  const invoiceAmount = round2(proration.amount - creditApplied)
  const dueDate = new Date(today.getTime() + CHARGE_DUE_DAYS * DAY_MS)
  const creditNote = creditApplied > 0 ? ` (учтён кредит ${rub(creditApplied)} ₽)` : ""

  let created = false
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const number = await nextInvoiceNumber(today)
    try {
      await db.$transaction(async (tx) => {
        const invoice = await tx.billingInvoice.create({
          data: {
            subscriptionId: subscription.id,
            organizationId: tenantId,
            number,
            amount: invoiceAmount,
            periodMonths: paidInvoice!.periodMonths,
            branchCount,
            isAdjustment: true,
            creditApplied,
            status: "pending",
            periodStart: today,
            periodEnd: paidInvoice!.periodEnd,
            dueDate,
            comment: `Перерасчёт SaaS «Умная CRM»: филиалов ${oldBranchCount} → ${branchCount}, доплата за ${proration.remainingDays} из ${proration.totalDays} дн. оплаченного периода${creditNote}`,
          },
        })
        await tx.billingSubscription.update({
          where: { id: subscription.id },
          data:
            creditApplied > 0
              ? { ...subData, creditBalance: { decrement: creditApplied } }
              : subData,
        })
        // Кредит израсходован полностью — убираем информационное уведомление
        // «Кредит … зачтётся в следующий счёт» (симметрично генератору счетов).
        if (creditApplied > 0 && round2(creditAvailable - creditApplied) <= 0) {
          await tx.notification.deleteMany({ where: { tenantId, type: "billing_credit" } })
        }
        await tx.billingAdjustment.create({
          data: { ...auditBase, kind: "charge", invoiceId: invoice.id },
        })

        if (invoiceAmount <= 0) {
          // Доплата полностью погашена кредитом — счёт сразу оплачен (без блока
          // и без уведомления «оплатите»).
          await applyInvoicePayment(tx, {
            invoiceId: invoice.id,
            paidVia: "manual",
            paidAmount: 0,
            comment: "Полностью погашено кредитом за перерасчёт филиалов",
          })
        } else if (recipients.length) {
          await tx.notification.createMany({
            data: recipients.map((r) => ({
              tenantId,
              employeeId: r.id,
              type: "billing_invoice" as const,
              title: `Доплата за филиалы: счёт №${number} на ${rub(invoiceAmount)} ₽`,
              message: `Филиалов стало ${oldBranchCount} → ${branchCount}. Доплата за остаток оплаченного периода${creditNote}, оплатить до ${fmtDate(dueDate)}. Нажмите, чтобы открыть счёт (PDF).`,
              entityType: "BillingInvoice",
              entityId: invoice.id,
            })),
          })
        }
      })
      created = true
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e
    }
  }
  if (!created) {
    throw new Error(`Не удалось выставить доплатный счёт за филиалы для организации ${tenantId}`)
  }
}
