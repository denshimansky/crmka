// Автовыставление SaaS-счетов партнёрам (20-е число, далее ежедневно до конца
// месяца — самовосстановление после задержек GH Actions и дозапуск для
// организаций, у которых ИНН заполнили после 20-го).
//
// Каждой не-exempt подписке (кроме cancelled), у которой оплаченный период
// кончается к 1-му числу следующего месяца, выставляется счёт на период
// с 1-го числа, сумма — строго по тарифной сетке × billingPeriodMonths.
// Заблокированные подписки НЕ исключаются: счета продолжают выставляться,
// пока подписку не отменили в админке (иначе после разблокировки задним
// числом появлялись бы «дыры» в периодах).
//
// Владелец и управляющие получают уведомление в колокольчик со ссылкой
// на PDF счёта (entityType=BillingInvoice → /api/billing/invoices/{id}/pdf).

import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { monthlyPriceFor } from "@/lib/billing-price"
import { nextInvoiceNumber } from "@/lib/billing/invoice-number"
import { ensureOrgLegalName } from "@/lib/billing/checko"

const round2 = (n: number) => Math.round(n * 100) / 100

const fmtDate = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`

export interface GenerateInvoicesResult {
  created: number
  skippedAlreadyInvoiced: number
  skippedNoInn: { orgId: string; name: string }[]
  /** Подписки с nextPaymentDate в прошлом (долг за прошлые периоды — разобрать вручную) */
  debtWarning: { orgName: string; nextPaymentDate: string }[]
}

export async function generateBillingInvoices(
  now: Date = new Date()
): Promise<GenerateInvoicesResult> {
  // 1-е число следующего месяца (UTC) — начало оплачиваемого периода и срок оплаты
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const subs = await db.billingSubscription.findMany({
    where: {
      status: { not: "cancelled" },
      nextPaymentDate: { lte: nextMonthStart },
      organization: { billingExempt: false },
    },
    include: {
      plan: true,
      organization: { select: { id: true, name: true, legalName: true, inn: true } },
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

    // Без ИНН счёт не выставляем: нечем матчить оплату по выписке,
    // в PDF нет заказчика. Админ заполняет ИНН → следующий прогон создаст.
    if (!org.inn || !org.inn.trim()) {
      result.skippedNoInn.push({ orgId: org.id, name: org.name })
      continue
    }

    // Официальное наименование заказчика для PDF берём из ЕГРЮЛ/ЕГРИП (checko).
    // Если ещё не подтянуто — подтягиваем сейчас и сохраняем в organization,
    // чтобы в счёте был не «ДЦ …» из системы, а реальное юрлицо/ИП.
    // Best-effort: при недоступности checko счёт всё равно выставляем (в PDF
    // отрендерится прежний фоллбэк на organization.name).
    if (!org.legalName || !org.legalName.trim()) {
      try {
        await ensureOrgLegalName(org)
      } catch {
        // не блокируем выставление счёта
      }
    }

    // Идемпотентность: счёт за этот период уже есть (pending/paid) — пропускаем.
    // cancelled не блокирует перевыставление.
    const existing = await db.billingInvoice.findFirst({
      where: {
        subscriptionId: sub.id,
        periodStart: nextMonthStart,
        status: { in: ["pending", "paid"] },
      },
      select: { id: true },
    })
    if (existing) {
      result.skippedAlreadyInvoiced++
      continue
    }

    // Долг за прошлые периоды в счёт не включаем (сумма строго по сетке) —
    // отдаём в ответ крона на ручную разборку.
    if (sub.nextPaymentDate < currentMonthStart) {
      result.debtWarning.push({
        orgName: org.name,
        nextPaymentDate: sub.nextPaymentDate.toISOString().slice(0, 10),
      })
    }

    const periodMonths = sub.billingPeriodMonths || 1
    const amount = round2(monthlyPriceFor(sub.plan, sub.branchCount) * periodMonths)
    // Последний день последнего месяца периода (как в образце: 01.07–31.07)
    const periodEnd = new Date(
      Date.UTC(nextMonthStart.getUTCFullYear(), nextMonthStart.getUTCMonth() + periodMonths, 0)
    )

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
      const number = await nextInvoiceNumber(nextMonthStart)
      try {
        await db.$transaction(async (tx) => {
          const invoice = await tx.billingInvoice.create({
            data: {
              subscriptionId: sub.id,
              organizationId: org.id,
              number,
              amount,
              periodMonths,
              branchCount: sub.branchCount,
              status: "pending",
              periodStart: nextMonthStart,
              periodEnd,
              dueDate: nextMonthStart,
              comment: `SaaS «Умная CRM», ${sub.branchCount} фил. × ${periodMonths} мес.`,
            },
          })

          if (recipients.length > 0) {
            await tx.notification.createMany({
              data: recipients.map((r) => ({
                tenantId: org.id,
                employeeId: r.id,
                type: "billing_invoice" as const,
                title: `Оплатите счёт №${number} на ${amount.toLocaleString("ru-RU")} ₽`,
                message: `Период ${fmtDate(nextMonthStart)}–${fmtDate(periodEnd)}, оплатить до ${fmtDate(nextMonthStart)}. Нажмите, чтобы открыть счёт (PDF).`,
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
