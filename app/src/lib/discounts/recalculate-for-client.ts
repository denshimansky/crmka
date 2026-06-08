// Применение/снятие шаблонной скидки клиента ко всем его не оплаченным
// pending/active абонементам. Идемпотентно: можно вызывать после любого
// изменения состава абонементов или смены Client.discountTemplateId.
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
 * Для linked-шаблонов проверяет условие применимости и возвращает список
 * (ровно одного) абонемента-получателя — самого дешёвого по finalAmount.
 * Для permanent возвращает все.
 */
function pickRecipients(
  kind: "permanent" | "linked_sibling" | "linked_second_direction",
  subs: SubLite[],
): SubLite[] {
  if (kind === "permanent") return subs
  if (subs.length === 0) return []

  if (kind === "linked_sibling") {
    const wardIds = new Set(subs.map((s) => s.wardId ?? ""))
    // Условие: ≥ 2 разных ward (включая «нет ward» как отдельный).
    const wardsCount = [...wardIds].filter((w) => w !== "").length
    if (wardsCount < 2) return []
  } else {
    // linked_second_direction
    const byWard = new Map<string, Set<string>>()
    for (const s of subs) {
      const w = s.wardId ?? ""
      if (!w) continue
      if (!byWard.has(w)) byWard.set(w, new Set())
      byWard.get(w)!.add(s.directionId)
    }
    const hasTwo = [...byWard.values()].some((d) => d.size >= 2)
    if (!hasTwo) return []
  }

  // Самый дешёвый по finalAmount, при равенстве — стабильно по id ASC.
  const sorted = [...subs].sort((a, b) => {
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

  // Кандидаты: pending/active абонементы без оплат. Оплаченные не трогаем —
  // пересчёт скидки уже не корректен, надо делать возврат отдельно.
  const subsRaw = await db.subscription.findMany({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      deletedAt: null,
      status: { in: ["pending", "active"] },
      chargedAmount: { equals: 0 },
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
  }))

  // Назначаем кому какую скидку дать. Если шаблон неактивен — обнуляем как при null.
  const targetRecipients =
    template && template.isActive ? pickRecipients(template.kind, subs) : []
  const targetIds = new Set(targetRecipients.map((s) => s.id))

  // Запоминаем, у каких абонементов была применена шаблонная скидка ДО пересчёта.
  // Только их discountAmount мы вправе сбрасывать в 0 — иначе затрём
  // ручную скидку, введённую в форме создания/редактирования абонемента.
  const priorTemplateDiscounts = await db.discount.findMany({
    where: {
      subscription: { clientId: input.clientId, tenantId: input.tenantId },
      templateId: { not: null },
      isActive: true,
    },
    select: { subscriptionId: true },
  })
  const priorTemplateSubIds = new Set(
    priorTemplateDiscounts.map((d) => d.subscriptionId),
  )

  // Снимаем все шаблонные Discount у клиента в этих абонах.
  await db.discount.deleteMany({
    where: {
      subscription: { clientId: input.clientId, tenantId: input.tenantId },
      templateId: { not: null },
      isActive: true,
    },
  })

  // Для каждого абонемента — целевая сумма скидки и пересчёт Subscription.
  for (const sub of subs) {
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
      for (const removal of result.removed) {
        const who = removal.wardName ? `${removal.wardName} · ` : ""
        await db.notification.createMany({
          data: recipients.map((r) => ({
            tenantId: input.tenantId,
            employeeId: r.id,
            type: "linked_discount_warning" as const,
            title: `Снята скидка «${removal.templateName}» — ${clientName}`,
            message: `${who}${removal.directionName}. Условие шаблона больше не выполняется (было −${removal.previousAmount.toLocaleString("ru-RU")} ₽).`,
            entityType: "Client",
            entityId: input.clientId,
          })),
        })
      }
    }
  }

  return result
}
