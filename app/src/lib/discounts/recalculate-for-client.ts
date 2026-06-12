// Применение/снятие шаблонной скидки клиента. Условие linked-шаблонов
// проверяется по всем живым (pending/active) абонементам, получатель —
// один самый дешёвый из не оплаченных и без списаний. Идемпотентно: можно
// вызывать после любого изменения состава абонементов (создание, выписка,
// смена статуса) или смены Client.discountTemplateId.
//
// Старые записи Discount без templateId — не трогаем (это исторический пласт
// recalcLinkedDiscounts). Здесь работаем только с шаблонами новой логики.

import { Prisma, type PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

interface RecalculateInput {
  tenantId: string
  clientId: string
  /** ID сотрудника-инициатора (для аудита). */
  createdBy?: string | null
}

export interface TemplateDiscountRemoval {
  subscriptionId: string
  previousAmount: number
  templateName: string
  templateKind: "permanent" | "linked_sibling" | "linked_second_direction"
  wardName: string | null
  directionName: string
}

export interface RecalculateResult {
  /** Абонементы, у которых шаблонная скидка была снята автоматически. */
  removed: TemplateDiscountRemoval[]
}

interface SubLite {
  id: string
  wardId: string | null
  directionId: string
  lessonPrice: Prisma.Decimal
  totalLessons: number
  totalAmount: Prisma.Decimal
  discountAmount: Prisma.Decimal
  finalAmount: Prisma.Decimal
  chargedAmount: Prisma.Decimal
  paymentsCount: number
}

function decimalCmp(a: Prisma.Decimal, b: Prisma.Decimal): number {
  return a.comparedTo(b)
}

/**
 * Вычисляет calculatedAmount по шаблону и параметрам абонемента.
 * Возвращает null, если применение бессмысленно (fixed-цена ≥ lessonPrice).
 */
function computeDiscountAmount(
  template: { valueType: "percent" | "fixed"; value: Prisma.Decimal },
  sub: { lessonPrice: Prisma.Decimal; totalLessons: number; totalAmount: Prisma.Decimal },
): Prisma.Decimal | null {
  if (template.valueType === "percent") {
    if (template.value.lessThanOrEqualTo(0)) return null
    return sub.totalAmount.mul(template.value).div(100)
  }
  // fixed = «стоимость занятия со скидкой»
  if (template.value.greaterThanOrEqualTo(sub.lessonPrice)) return null
  return sub.lessonPrice.minus(template.value).mul(sub.totalLessons)
}

/**
 * Для linked-шаблонов проверяет условие применимости (по ВСЕМ живым
 * pending/active абонементам — оплаченные и начатые тоже подтверждают,
 * что ребёнок/направление действующие) и возвращает список (ровно одного)
 * абонемента-получателя — самого дешёвого по finalAmount из кандидатов
 * (не оплаченных и без списаний). Для permanent возвращает всех кандидатов.
 */
function pickRecipients(
  kind: "permanent" | "linked_sibling" | "linked_second_direction",
  eligible: SubLite[],
  candidates: SubLite[],
): SubLite[] {
  if (kind === "permanent") return candidates
  if (candidates.length === 0) return []

  if (kind === "linked_sibling") {
    const wardIds = new Set(eligible.map((s) => s.wardId ?? ""))
    // Условие: ≥ 2 разных ward (включая «нет ward» как отдельный).
    const wardsCount = [...wardIds].filter((w) => w !== "").length
    if (wardsCount < 2) return []
  } else {
    // linked_second_direction
    const byWard = new Map<string, Set<string>>()
    for (const s of eligible) {
      const w = s.wardId ?? ""
      if (!w) continue
      if (!byWard.has(w)) byWard.set(w, new Set())
      byWard.get(w)!.add(s.directionId)
    }
    const hasTwo = [...byWard.values()].some((d) => d.size >= 2)
    if (!hasTwo) return []
  }

  // Самый дешёвый по finalAmount, при равенстве — стабильно по id ASC.
  const sorted = [...candidates].sort((a, b) => {
    const c = decimalCmp(a.finalAmount, b.finalAmount)
    return c !== 0 ? c : a.id.localeCompare(b.id)
  })
  return [sorted[0]]
}

export async function recalculateDiscountsForClient(
  db: Tx,
  input: RecalculateInput,
): Promise<RecalculateResult> {
  const result: RecalculateResult = { removed: [] }
  const client = await db.client.findFirst({
    where: { id: input.clientId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, discountTemplateId: true },
  })
  if (!client) return result

  const template = client.discountTemplateId
    ? await db.discountTemplate.findFirst({
        where: { id: client.discountTemplateId, tenantId: input.tenantId },
        select: { id: true, name: true, kind: true, valueType: true, value: true, isActive: true },
      })
    : null

  // Все живые абонементы клиента: по ним проверяется УСЛОВИЕ linked-шаблонов
  // (второй ребёнок/направление считается и по оплаченным/начатым абонементам).
  // Кандидаты на скидку — только не оплаченные и без списаний: пересчёт
  // оплаченного некорректен (для корректировки — возврат), начатого — тем более.
  const subsRaw = await db.subscription.findMany({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      deletedAt: null,
      status: { in: ["pending", "active"] },
    },
    select: {
      id: true,
      wardId: true,
      directionId: true,
      lessonPrice: true,
      totalLessons: true,
      totalAmount: true,
      discountAmount: true,
      finalAmount: true,
      chargedAmount: true,
      ward: { select: { firstName: true, lastName: true } },
      direction: { select: { name: true } },
      _count: { select: { payments: { where: { deletedAt: null } } } },
    },
  })

  const subs: SubLite[] = subsRaw.map((s) => ({
    id: s.id,
    wardId: s.wardId,
    directionId: s.directionId,
    lessonPrice: new Prisma.Decimal(s.lessonPrice),
    totalLessons: s.totalLessons,
    totalAmount: new Prisma.Decimal(s.totalAmount),
    discountAmount: new Prisma.Decimal(s.discountAmount),
    finalAmount: new Prisma.Decimal(s.finalAmount),
    chargedAmount: new Prisma.Decimal(s.chargedAmount),
    paymentsCount: s._count.payments,
  }))
  const candidates = subs.filter(
    (s) => s.chargedAmount.isZero() && s.paymentsCount === 0,
  )
  const candidateIds = candidates.map((s) => s.id)

  // Назначаем кому какую скидку дать. Если шаблон неактивен — обнуляем как при null.
  const targetRecipients =
    template && template.isActive ? pickRecipients(template.kind, subs, candidates) : []
  const targetIds = new Set(targetRecipients.map((s) => s.id))

  // Запоминаем, у каких абонементов была применена шаблонная скидка ДО пересчёта.
  // Только их discountAmount мы вправе сбрасывать в 0 — иначе затрём
  // ручную скидку, введённую в форме создания/редактирования абонемента.
  const priorTemplateDiscounts = await db.discount.findMany({
    where: {
      subscriptionId: { in: candidateIds },
      templateId: { not: null },
      isActive: true,
    },
    select: { subscriptionId: true },
  })
  const priorTemplateSubIds = new Set(
    priorTemplateDiscounts.map((d) => d.subscriptionId),
  )

  // Снимаем шаблонные Discount только у кандидатов. Оплаченные/начатые
  // абонементы не трогаем: их Discount-записи — история для отчёта
  // «Связанные скидки» и колонки «Скидка» в реестре.
  await db.discount.deleteMany({
    where: {
      subscriptionId: { in: candidateIds },
      templateId: { not: null },
      isActive: true,
    },
  })

  // Для каждого кандидата — целевая сумма скидки и пересчёт Subscription.
  for (const sub of candidates) {
    let newDiscount = new Prisma.Decimal(0)
    let appliedTemplate = false
    if (template && targetIds.has(sub.id)) {
      const computed = computeDiscountAmount(template, sub)
      if (computed && computed.greaterThan(0)) {
        newDiscount = computed
        appliedTemplate = true
        await db.discount.create({
          data: {
            tenantId: input.tenantId,
            subscriptionId: sub.id,
            templateId: template.id,
            type:
              template.kind === "permanent"
                ? "permanent"
                : "linked",
            valueType: template.valueType,
            value: template.value,
            calculatedAmount: newDiscount,
            startDate: new Date(),
            isActive: true,
            createdBy: input.createdBy ?? null,
          },
        })
      }
    }

    // Если шаблонная скидка не применилась сейчас И не была применена раньше —
    // discountAmount принадлежит «ручному» вводу, не трогаем.
    if (!appliedTemplate && !priorTemplateSubIds.has(sub.id)) continue

    if (!newDiscount.equals(sub.discountAmount)) {
      const previousAmount = sub.discountAmount
      const newFinal = sub.totalAmount.minus(newDiscount)
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          discountAmount: newDiscount,
          finalAmount: newFinal,
          // chargedAmount=0 по выборке, поэтому balance = finalAmount.
          balance: newFinal,
        },
      })

      // Снятие шаблонной скидки: фиксируем для алёрта в ответе API
      // и аудита. Не учитываем кейс, где скидка просто «уточнилась» вверх
      // или вниз — для UX важен именно факт исчезновения.
      if (
        !appliedTemplate &&
        previousAmount.greaterThan(0) &&
        template
      ) {
        const raw = subsRaw.find((r) => r.id === sub.id)
        const wardName = raw?.ward
          ? [raw.ward.lastName, raw.ward.firstName].filter(Boolean).join(" ").trim() || null
          : null
        const removal: TemplateDiscountRemoval = {
          subscriptionId: sub.id,
          previousAmount: previousAmount.toNumber(),
          templateName: template.name,
          templateKind: template.kind,
          wardName,
          directionName: raw?.direction.name ?? "",
        }
        result.removed.push(removal)
        // AuditLog.employeeId — NOT NULL, поэтому пишем след только для
        // ручных операций (PATCH /subscriptions). Для cron'ов уведомление
        // идёт через Notification в колокольчик.
        if (input.createdBy) {
          await db.auditLog.create({
            data: {
              tenantId: input.tenantId,
              employeeId: input.createdBy,
              action: "template_discount_removed_auto",
              entityType: "Client",
              entityId: input.clientId,
              changes: {
                subscriptionId: sub.id,
                templateName: template.name,
                templateKind: template.kind,
                previousAmount: previousAmount.toNumber(),
                wardName,
                directionName: raw?.direction.name ?? "",
              },
            },
          })
        }
      }
      // clientBalance не зависит от finalAmount абонемента (долг живёт на
      // Subscription.balance), поэтому correction-проводка не требуется.
    }
  }

  // Уведомления в колокольчик для админов/управляющих/владельца — чтобы
  // снятие шаблонной скидки не прошло незаметно при cron-операциях.
  if (result.removed.length > 0) {
    const recipients = await db.employee.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        role: { in: ["owner", "manager", "admin"] },
      },
      select: { id: true },
    })
    if (recipients.length > 0) {
      const fullClient = await db.client.findUnique({
        where: { id: input.clientId },
        select: { firstName: true, lastName: true },
      })
      const clientName =
        [fullClient?.lastName, fullClient?.firstName].filter(Boolean).join(" ") ||
        "Клиент"
      // Если получатель есть — скидка не исчезла, а переехала на самый
      // дешёвый неоплаченный абонемент; текст уведомления различаем.
      const moved = targetIds.size > 0
      for (const removal of result.removed) {
        const who = removal.wardName ? `${removal.wardName} · ` : ""
        await db.notification.createMany({
          data: recipients.map((r) => ({
            tenantId: input.tenantId,
            employeeId: r.id,
            type: "linked_discount_warning" as const,
            title: moved
              ? `Скидка «${removal.templateName}» перенесена — ${clientName}`
              : `Снята скидка «${removal.templateName}» — ${clientName}`,
            message: moved
              ? `${who}${removal.directionName}. Скидка переехала на самый дешёвый неоплаченный абонемент (было −${removal.previousAmount.toLocaleString("ru-RU")} ₽).`
              : `${who}${removal.directionName}. Условие шаблона больше не выполняется (было −${removal.previousAmount.toLocaleString("ru-RU")} ₽).`,
            entityType: "Client",
            entityId: input.clientId,
          })),
        })
      }
    }
  }

  return result
}
