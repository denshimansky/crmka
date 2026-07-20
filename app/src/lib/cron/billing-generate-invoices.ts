// Автовыставление SaaS-счетов партнёрам. Крон ежедневный; две схемы (Bug #65):
//
//  • LEGACY (billingAnchorDay = null) — текущие партнёры: счёт на 1-е число
//    следующего месяца, генерация только с 20-го (гейт по дню), срок оплаты 1-е.
//    Поведение полностью сохранено.
//  • ANCHORED (billingAnchorDay задан) — новые партнёры с индивидуальным
//    днём-якорем: срок оплаты = день-якорь месяца, счёт выставляется за 10 дней
//    до срока (shouldIssueAnchored). Первый счёт теста — за 10 дней до конца
//    теста (= на 4-й день). Сумма строго по сетке × billingPeriodMonths.
//
// Заблокированные подписки НЕ исключаются: счета продолжают выставляться, пока
// подписку не отменили (иначе после разблокировки задним числом были бы «дыры»).
// Владелец и управляющие получают уведомление в колокольчик со ссылкой на PDF.

import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { monthlyPriceFor } from "@/lib/billing-price"
import { nextInvoiceNumber } from "@/lib/billing/invoice-number"
import { ensureOrgLegalName } from "@/lib/billing/checko"
import { planInvoice } from "@/lib/billing/billing-schedule"

const round2 = (n: number) => Math.round(n * 100) / 100

const fmtDate = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`

export interface GenerateInvoicesResult {
  created: number
  skippedAlreadyInvoiced: number
  skippedNoInn: { orgId: string; name: string }[]
  /** Legacy-подписки с nextPaymentDate в прошлом (долг за прошлые периоды) */
  debtWarning: { orgName: string; nextPaymentDate: string }[]
}

export async function generateBillingInvoices(
  now: Date = new Date()
): Promise<GenerateInvoicesResult> {
  // Тянем все не-отменённые подписки не-exempt организаций и решаем по каждой
  // чистой функцией planInvoice. (Volume — десятки строк; отдельный DB-фильтр
  // по nextPaymentDate ронял бы anchored-подписки с якорем ≤10 числа, у которых
  // дата выставления в прошлом календарном месяце — см. Bug #65.)
  const subs = await db.billingSubscription.findMany({
    where: {
      status: { not: "cancelled" },
      organization: { billingExempt: false },
    },
    include: {
      plan: true,
      organization: {
        select: { id: true, name: true, legalName: true, inn: true },
      },
    },
  })

  const result: GenerateInvoicesResult = {
    created: 0,
    skippedAlreadyInvoiced: 0,
    skippedNoInn: [],
    debtWarning: [],
  }

  for (const sub of subs) {
    const org = sub.organization

    // Пора ли выставлять счёт этой подписке сейчас (legacy/anchored — внутри)
    const plan = planInvoice(sub, now)
    if (!plan) continue

    // Без ИНН счёт не выставляем: нечем матчить оплату по выписке, в PDF нет
    // заказчика. Для новых партнёров ИНН обязателен при создании (Bug #65).
    if (!org.inn || !org.inn.trim()) {
      result.skippedNoInn.push({ orgId: org.id, name: org.name })
      continue
    }

    // Официальное наименование заказчика из ЕГРЮЛ/ЕГРИП (best-effort, checko).
    if (!org.legalName || !org.legalName.trim()) {
      try {
        await ensureOrgLegalName(org)
      } catch {
        // не блокируем выставление счёта
      }
    }

    const periodMonths = sub.billingPeriodMonths || 1
    const branchCount = sub.branchCount
    const { periodStart, periodEnd, dueDate } = plan

    // Долг за прошлые периоды (legacy) в счёт не включаем — на ручную разборку
    if (plan.isPastDuePeriod) {
      result.debtWarning.push({
        orgName: org.name,
        nextPaymentDate: sub.nextPaymentDate.toISOString().slice(0, 10),
      })
    }

    // Идемпотентность: счёт за этот период уже есть — пропускаем
    const existing = await db.billingInvoice.findFirst({
      where: {
        subscriptionId: sub.id,
        periodStart,
        status: { in: plan.idempotencyStatuses },
      },
      select: { id: true },
    })
    if (existing) {
      result.skippedAlreadyInvoiced++
      continue
    }

    const amount = round2(monthlyPriceFor(sub.plan, branchCount) * periodMonths)

    const recipients = await db.employee.findMany({
      where: {
        tenantId: org.id,
        isActive: true,
        deletedAt: null,
        role: { in: ["owner", "manager"] },
      },
      select: { id: true },
    })

    // Номер: гонка по unique(number) разрешается ретраем
    let created = false
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const number = await nextInvoiceNumber(periodStart)
      try {
        await db.$transaction(async (tx) => {
          const invoice = await tx.billingInvoice.create({
            data: {
              subscriptionId: sub.id,
              organizationId: org.id,
              number,
              amount,
              periodMonths,
              branchCount,
              status: "pending",
              periodStart,
              periodEnd,
              dueDate,
              comment: `SaaS «Умная CRM», ${branchCount} фил. × ${periodMonths} мес.`,
            },
          })

          if (recipients.length > 0) {
            await tx.notification.createMany({
              data: recipients.map((r) => ({
                tenantId: org.id,
                employeeId: r.id,
                type: "billing_invoice" as const,
                title: `Оплатите счёт №${number} на ${amount.toLocaleString("ru-RU")} ₽`,
                message: `Период ${fmtDate(periodStart)}–${fmtDate(periodEnd)}, оплатить до ${fmtDate(dueDate)}. Нажмите, чтобы открыть счёт (PDF).`,
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
      throw new Error(`Не удалось сгенерировать уникальный номер счёта для ${org.name}`)
    }
    result.created++
  }

  return result
}
