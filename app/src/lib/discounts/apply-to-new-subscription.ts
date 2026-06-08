// Применение шаблонной скидки клиента к одному (новому) абонементу.
// В отличие от recalculateDiscountsForClient — НЕ пересчитывает другие
// абонементы клиента. Бизнес-правило: шаблонная скидка применяется только
// к абонементам, выписанным ПОСЛЕ установки шаблона на клиенте.

import { Prisma, type PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

interface ApplyInput {
  tenantId: string
  clientId: string
  subscriptionId: string
  createdBy?: string | null
}

function computeDiscountAmount(
  template: { valueType: "percent" | "fixed"; value: Prisma.Decimal },
  sub: { lessonPrice: Prisma.Decimal; totalLessons: number; totalAmount: Prisma.Decimal },
): Prisma.Decimal | null {
  if (template.valueType === "percent") {
    if (template.value.lessThanOrEqualTo(0)) return null
    return sub.totalAmount.mul(template.value).div(100)
  }
  if (template.value.greaterThanOrEqualTo(sub.lessonPrice)) return null
  return sub.lessonPrice.minus(template.value).mul(sub.totalLessons)
}

export async function applyDiscountToNewSubscription(
  db: Tx,
  input: ApplyInput,
): Promise<void> {
  const client = await db.client.findFirst({
    where: { id: input.clientId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, discountTemplateId: true },
  })
  if (!client?.discountTemplateId) return

  const template = await db.discountTemplate.findFirst({
    where: {
      id: client.discountTemplateId,
      tenantId: input.tenantId,
      isActive: true,
    },
    select: { id: true, kind: true, valueType: true, value: true },
  })
  if (!template) return

  const sub = await db.subscription.findFirst({
    where: {
      id: input.subscriptionId,
      tenantId: input.tenantId,
      clientId: input.clientId,
      deletedAt: null,
    },
    select: {
      id: true,
      wardId: true,
      directionId: true,
      lessonPrice: true,
      totalLessons: true,
      totalAmount: true,
      discountAmount: true,
      chargedAmount: true,
    },
  })
  if (!sub) return

  // Абонементы со списаниями не пересчитываем — скидка после отметки
  // занятий не применяется, для корректировки — возврат.
  if (new Prisma.Decimal(sub.chargedAmount).greaterThan(0)) return

  // Проверка применимости для linked-видов. Считаем по составу всех живых
  // абонементов клиента (включая этот, новый).
  if (template.kind === "linked_sibling") {
    if (!sub.wardId) return
    const peers = await db.subscription.findMany({
      where: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        deletedAt: null,
        status: { in: ["pending", "active"] },
      },
      select: { wardId: true },
    })
    const wardIds = new Set(
      peers.map((p) => p.wardId).filter((w): w is string => !!w),
    )
    if (wardIds.size < 2) return
  } else if (template.kind === "linked_second_direction") {
    if (!sub.wardId) return
    const peers = await db.subscription.findMany({
      where: {
        tenantId: input.tenantId,
        clientId: input.clientId,
        wardId: sub.wardId,
        deletedAt: null,
        status: { in: ["pending", "active"] },
      },
      select: { directionId: true },
    })
    const dirs = new Set(peers.map((p) => p.directionId))
    if (dirs.size < 2) return
  }

  const tplValue = new Prisma.Decimal(template.value)
  const computed = computeDiscountAmount(
    { valueType: template.valueType, value: tplValue },
    {
      lessonPrice: new Prisma.Decimal(sub.lessonPrice),
      totalLessons: sub.totalLessons,
      totalAmount: new Prisma.Decimal(sub.totalAmount),
    },
  )
  if (!computed || computed.lessThanOrEqualTo(0)) return

  // Снимаем возможные предыдущие шаблонные Discount у этого абонемента
  // (на случай повторного вызова) — идемпотентность.
  await db.discount.deleteMany({
    where: {
      subscriptionId: sub.id,
      templateId: { not: null },
      isActive: true,
    },
  })

  const newFinal = new Prisma.Decimal(sub.totalAmount).minus(computed)
  await db.subscription.update({
    where: { id: sub.id },
    data: {
      discountAmount: computed,
      finalAmount: newFinal,
      balance: newFinal,
    },
  })
  await db.discount.create({
    data: {
      tenantId: input.tenantId,
      subscriptionId: sub.id,
      templateId: template.id,
      type: template.kind === "permanent" ? "permanent" : "linked",
      valueType: template.valueType,
      value: tplValue,
      calculatedAmount: computed,
      startDate: new Date(),
      isActive: true,
      createdBy: input.createdBy ?? null,
    },
  })
}
