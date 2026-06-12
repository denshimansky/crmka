// Скидки v2 — единый сервис пересчёта скидок клиента (docs/discounts-v2.md).
//
// Тип 1 «Скидка за второй абонемент» (системный шаблон, kind=second_subscription):
//   автоматический инвариант в рамках календарного месяца периода — скидку несут
//   все абонементы месяца, кроме самого дорогого по totalAmount (тай-брейк: при
//   равенстве освобождается выписанный раньше; createdAt, затем id).
// Тип 2 (kind=permanent, выбран в карточке клиента): эксклюзивен и приоритетен —
//   тип 1 для клиента не действует; применяется только к НОВЫМ абонементам
//   (newSubscriptionIds) и заменяет уже выданные тип-1-скидки.
//
// Скидка живёт в цене занятия: эффективная цена = max(0, lessonPrice − perLesson).
// Прошлые списания — снимок (не пересчитываются), скидка меняет только
// оставшиеся занятия: finalAmount = chargedAmount + остаток × эффективная цена.
// Деньги: оплачено больше новой стоимости → возврат на баланс родителя
// (discount_refund) + сторно-платёж transfer_in с минусом (мимо кассы и ДДС).
//
// Замороженные скидки старой логики (discountSource=legacy) не изменяются ни
// одним триггером; их абонементы участвуют в составе месяца по totalAmount.
//
// Идемпотентен. Все триггеры (создание/отчисление/удаление/правка абонемента,
// смена шаблона клиента, включение тоггла) зовут только этот сервис.

import { Prisma, type PrismaClient } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { activateSubscription } from "@/lib/subscriptions/activate-subscription"

type Tx = Prisma.TransactionClient | PrismaClient

export const TYPE1_SYSTEM_KEY = "second_subscription"

export interface RecalcDiscountsInput {
  tenantId: string
  clientId: string
  createdBy?: string | null
  /** Только что созданные абонементы — единственные получатели типа 2. */
  newSubscriptionIds?: string[]
}

export interface DiscountChange {
  subscriptionId: string
  action: "applied" | "removed" | "replaced"
  source: "type1" | "type2"
  /** Возвращено на баланс родителя (₽), если оплачено больше новой стоимости. */
  refundedToBalance: number
}

export interface RecalcDiscountsResult {
  changes: DiscountChange[]
}

interface TemplateLite {
  id: string
  name: string
  valueType: "percent" | "fixed"
  value: Prisma.Decimal
}

interface SubMoney {
  id: string
  clientId: string
  wardId: string | null
  groupId: string
  directionId: string
  status: string
  lessonPrice: Prisma.Decimal
  totalLessons: number
  totalAmount: Prisma.Decimal
  chargedAmount: Prisma.Decimal
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1)
}

/** Число «использованных» занятий: отметки, списывающие занятие с абонемента
 *  (включая бесплатные при 100% скидке). Заглушки isPending не считаются. */
export async function countAttendedLessons(
  t: Tx,
  tenantId: string,
  subscriptionId: string,
): Promise<number> {
  return t.attendance.count({
    where: {
      tenantId,
      subscriptionId,
      isPending: false,
      attendanceType: { chargesSubscription: true },
    },
  })
}

/** Скидка за занятие по шаблону, ограниченная ценой занятия (занятие не дешевле 0). */
function perLessonByTemplate(tpl: TemplateLite, lessonPrice: Prisma.Decimal): Prisma.Decimal {
  const raw =
    tpl.valueType === "percent"
      ? lessonPrice.mul(tpl.value).div(100)
      : new Prisma.Decimal(tpl.value)
  if (raw.lessThanOrEqualTo(0)) return new Prisma.Decimal(0)
  return raw.greaterThan(lessonPrice) ? new Prisma.Decimal(lessonPrice) : raw
}

/**
 * Денежный пересчёт абонемента под заданную скидку за занятие:
 * finalAmount = снимок списаний + остаток × эффективная цена; переплата →
 * возврат на баланс (discount_refund) + сторно-платёж; недоплата → долг.
 * Возвращает сумму возврата.
 */
async function recomputeMoney(
  t: Tx,
  input: {
    tenantId: string
    sub: SubMoney
    attended: number
    perLesson: Prisma.Decimal
    source: "none" | "type1" | "type2" | "legacy"
    createdBy?: string | null
  },
): Promise<Prisma.Decimal> {
  const { tenantId, sub, attended, perLesson, source, createdBy } = input
  const remaining = Math.max(0, sub.totalLessons - attended)
  const lessonPrice = new Prisma.Decimal(sub.lessonPrice)
  const effective = Prisma.Decimal.max(new Prisma.Decimal(0), lessonPrice.minus(perLesson))
  const newFinal = new Prisma.Decimal(sub.chargedAmount).plus(effective.mul(remaining))

  // «Оплачено» = transfer_in (включая отрицательные сторно прошлых возвратов
  // по скидке) МИНУС возвраты/переносы с абонемента (Payment type=refund с
  // отрицательной суммой: реальный возврат из кассы и перенос баланса) —
  // иначе возврат по скидке вернул бы уже унесённые деньги второй раз.
  const paidAgg = await t.payment.aggregate({
    where: {
      tenantId,
      subscriptionId: sub.id,
      deletedAt: null,
      OR: [{ type: "transfer_in" }, { type: "refund", amount: { lt: 0 } }],
    },
    _sum: { amount: true },
  })
  const paid = new Prisma.Decimal(paidAgg._sum.amount ?? 0)

  let newBalance = newFinal.minus(paid)
  let refunded = new Prisma.Decimal(0)
  if (newBalance.isNegative()) {
    refunded = newBalance.abs()
    newBalance = new Prisma.Decimal(0)

    // Сторно-платёж: «оплачено» уменьшается, касса и ДДС не затронуты
    // (transfer_in в кассовые отчёты не входит). НЕ через /api/payments/refund.
    const account = await t.financialAccount.findFirst({
      where: { tenantId, isActive: true, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
    if (!account) {
      // Возврат без счёта невозможен — откатываем транзакцию пересчёта,
      // иначе переплата клиента молча исчезла бы из учёта.
      throw new Error("Возврат по скидке невозможен: нет активного счёта (кассы)")
    }
    if (account) {
      const storno = await t.payment.create({
        data: {
          tenantId,
          clientId: sub.clientId,
          subscriptionId: sub.id,
          accountId: account.id,
          amount: refunded.negated(),
          type: "transfer_in",
          method: "bank_transfer",
          date: new Date(),
          comment: "Возврат по скидке",
          createdBy: createdBy ?? null,
        },
        select: { id: true },
      })
      await applyBalanceDelta(t, {
        tenantId,
        clientId: sub.clientId,
        delta: refunded,
        type: "discount_refund",
        refs: { subscriptionId: sub.id, paymentId: storno.id, directionId: sub.directionId },
        comment: "Возврат по скидке",
        createdBy,
      })
    }
  }

  await t.subscription.update({
    where: { id: sub.id },
    data: {
      discountPerLesson: perLesson,
      discountSource: source,
      finalAmount: newFinal,
      discountAmount: new Prisma.Decimal(sub.totalAmount).minus(newFinal),
      balance: newBalance,
    },
  })

  // Автоактивация: долга не осталось (100% скидка или возврат «доплатил»).
  if (sub.status === "pending" && newBalance.lessThanOrEqualTo(0)) {
    await activateSubscription(t, {
      tenantId,
      subscription: {
        id: sub.id,
        clientId: sub.clientId,
        wardId: sub.wardId,
        groupId: sub.groupId,
        directionId: sub.directionId,
      },
      createdBy,
    })
  }

  return refunded
}

/**
 * Пересчёт денег одного абонемента БЕЗ изменения скидки — после правки
 * lessonPrice/totalLessons (PATCH). Для discountSource=legacy не применяется
 * (вызывающий код оставляет старую формулу totalAmount − discountAmount).
 */
export async function repriceSubscription(
  t: Tx,
  input: { tenantId: string; subscriptionId: string; createdBy?: string | null },
): Promise<void> {
  const sub = await t.subscription.findFirst({
    where: { id: input.subscriptionId, tenantId: input.tenantId, deletedAt: null },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      groupId: true,
      directionId: true,
      status: true,
      lessonPrice: true,
      totalLessons: true,
      totalAmount: true,
      chargedAmount: true,
      discountPerLesson: true,
      discountSource: true,
    },
  })
  // Только живые: пересчёт закрытого/отчисленного перетёр бы balance,
  // выставленный закрытием, и мог бы вернуть деньги второй раз.
  if (!sub || sub.discountSource === "legacy") return
  if (sub.status !== "pending" && sub.status !== "active") return
  const attended = await countAttendedLessons(t, input.tenantId, sub.id)
  // Скидка за занятие зафиксирована в рублях — при смене цены не пересчитывается
  // (только капится новой ценой).
  const perLesson = Prisma.Decimal.min(
    new Prisma.Decimal(sub.discountPerLesson),
    new Prisma.Decimal(sub.lessonPrice),
  )
  await recomputeMoney(t, {
    tenantId: input.tenantId,
    sub,
    attended,
    perLesson,
    source: sub.discountSource as "none" | "type1" | "type2",
    createdBy: input.createdBy,
  })
}

export async function recalcClientDiscounts(
  t: Tx,
  input: RecalcDiscountsInput,
): Promise<RecalcDiscountsResult> {
  const result: RecalcDiscountsResult = { changes: [] }
  const newIds = new Set(input.newSubscriptionIds ?? [])

  const client = await t.client.findFirst({
    where: { id: input.clientId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, discountTemplateId: true },
  })
  if (!client) return result

  // Тип 2: выбранный в карточке permanent-шаблон (не легаси). Грузим и
  // выключенный: «выключение шаблона — выданные скидки доживают», поэтому
  // выключенный, но выбранный шаблон блокирует любые изменения скидок клиента.
  const t2Row = client.discountTemplateId
    ? await t.discountTemplate.findFirst({
        where: {
          id: client.discountTemplateId,
          tenantId: input.tenantId,
          kind: "permanent",
          isLegacy: false,
        },
        select: { id: true, name: true, valueType: true, value: true, isActive: true },
      })
    : null
  if (t2Row && !t2Row.isActive) {
    // Шаблон типа 2 выключен организацией, но выбран у клиента: выданные
    // скидки доживают, новые абонементы — без скидки, тип 1 не действует
    // (эксклюзивность по выбору в карточке сохраняется).
    return result
  }
  const t2 = t2Row

  // Тип 1: системный шаблон. Новые скидки выдаются, только если включён;
  // на месяц периода — начиная со СЛЕДУЮЩЕГО месяца после включения
  // (activatedAt). Выданные ранее скидки при выключенном шаблоне доживают.
  const t1 = await t.discountTemplate.findFirst({
    where: { tenantId: input.tenantId, systemKey: TYPE1_SYSTEM_KEY },
    select: {
      id: true,
      name: true,
      valueType: true,
      value: true,
      isActive: true,
      activatedAt: true,
    },
  })
  const t1MinMonth =
    t1?.isActive && t1.activatedAt != null
      ? monthIndex(t1.activatedAt.getFullYear(), t1.activatedAt.getMonth() + 1) + 1
      : null

  const now = new Date()
  const currentMonth = monthIndex(now.getFullYear(), now.getMonth() + 1)

  // Абонементы: календарные текущего/будущих месяцев (живые + закрытые для
  // состава) и живые пакетные (только для типа 2). Прошедшие месяцы не трогаем.
  const subsRaw = await t.subscription.findMany({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      deletedAt: null,
      OR: [
        { type: "package", status: { in: ["pending", "active"] } },
        {
          type: { not: "package" },
          status: { in: ["pending", "active", "closed"] },
          periodYear: { not: null },
          periodMonth: { not: null },
        },
      ],
    },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      groupId: true,
      directionId: true,
      type: true,
      status: true,
      periodYear: true,
      periodMonth: true,
      lessonPrice: true,
      totalLessons: true,
      totalAmount: true,
      chargedAmount: true,
      discountPerLesson: true,
      discountSource: true,
      createdAt: true,
    },
  })

  type Row = (typeof subsRaw)[number]

  const calendarSubs = subsRaw.filter(
    (s) =>
      s.type !== "package" &&
      s.periodYear != null &&
      s.periodMonth != null &&
      monthIndex(s.periodYear, s.periodMonth) >= currentMonth,
  )
  const packageSubs = subsRaw.filter((s) => s.type === "package")

  // «Отхожено» одним запросом для всех.
  const allIds = [...calendarSubs, ...packageSubs].map((s) => s.id)
  const attendedRows = allIds.length
    ? await t.attendance.groupBy({
        by: ["subscriptionId"],
        where: {
          tenantId: input.tenantId,
          subscriptionId: { in: allIds },
          isPending: false,
          attendanceType: { chargesSubscription: true },
        },
        _count: { _all: true },
      })
    : []
  const attendedBySub = new Map<string, number>(
    attendedRows.map((r) => [r.subscriptionId as string, r._count._all]),
  )

  /** Применить/снять скидку на абонементе (только оставшиеся занятия). */
  async function setDiscount(
    sub: Row,
    target: { tpl: TemplateLite; source: "type1" | "type2" } | null,
  ): Promise<void> {
    const attended = attendedBySub.get(sub.id) ?? 0
    const remaining = Math.max(0, sub.totalLessons - attended)

    const newPerLesson = target
      ? perLessonByTemplate(target.tpl, new Prisma.Decimal(sub.lessonPrice))
      : new Prisma.Decimal(0)
    const newSource = target ? target.source : "none"

    const samePerLesson = newPerLesson.equals(new Prisma.Decimal(sub.discountPerLesson))
    if (newSource === sub.discountSource && samePerLesson) return
    // Не осталось занятий — менять нечего: прошлые списания не трогаем.
    if (remaining === 0) return

    const refunded = await recomputeMoney(t, {
      tenantId: input.tenantId,
      sub,
      attended,
      perLesson: newPerLesson,
      source: newSource,
      createdBy: input.createdBy,
    })

    // История применений: активную запись закрываем, новую создаём при выдаче.
    await t.discount.updateMany({
      where: {
        tenantId: input.tenantId,
        subscriptionId: sub.id,
        isActive: true,
        type: { in: ["second_subscription", "permanent"] },
        templateId: { not: null },
      },
      data: { isActive: false, endDate: new Date() },
    })
    if (target && newPerLesson.greaterThan(0)) {
      await t.discount.create({
        data: {
          tenantId: input.tenantId,
          subscriptionId: sub.id,
          templateId: target.tpl.id,
          type: target.source === "type1" ? "second_subscription" : "permanent",
          valueType: target.tpl.valueType,
          value: target.tpl.value,
          calculatedAmount: newPerLesson.mul(remaining),
          perLessonValue: newPerLesson,
          lessonsRemaining: remaining,
          startDate: new Date(),
          isActive: true,
          createdBy: input.createdBy ?? null,
        },
      })
    }

    const hadDiscount = new Prisma.Decimal(sub.discountPerLesson).greaterThan(0)
    result.changes.push({
      subscriptionId: sub.id,
      action: target ? (hadDiscount ? "replaced" : "applied") : "removed",
      source: target ? target.source : sub.discountSource === "type2" ? "type2" : "type1",
      refundedToBalance: refunded.toNumber(),
    })

    // Локально отражаем изменение для последующих шагов этого же прогона.
    sub.discountPerLesson = newPerLesson
    sub.discountSource = newSource as Row["discountSource"]
  }

  if (t2) {
    // Тип 2 эксклюзивен: тип 1 не действует. Получатели — только новые
    // абонементы и замена уже выданных тип-1-скидок. Старые без скидки и
    // legacy не трогаем.
    const targets = [...calendarSubs, ...packageSubs].filter(
      (s) =>
        (s.status === "pending" || s.status === "active") &&
        (newIds.has(s.id) || s.discountSource === "type1"),
    )
    for (const sub of targets) {
      await setDiscount(sub, { tpl: t2, source: "type2" })
    }
    return result
  }

  // Тип 2 не выбран. Пакетные с тип-2-скидкой — снять, но только если клиент
  // действительно снял выбор («Без скидки»); если шаблон удалён/легаси —
  // скидки доживают.
  if (client.discountTemplateId === null) {
    for (const sub of packageSubs) {
      if (sub.discountSource === "type2" && (sub.status === "pending" || sub.status === "active")) {
        await setDiscount(sub, null)
      }
    }
  }

  // Тип 1: инвариант по месяцам.
  const byMonth = new Map<number, Row[]>()
  for (const s of calendarSubs) {
    const mi = monthIndex(s.periodYear!, s.periodMonth!)
    if (!byMonth.has(mi)) byMonth.set(mi, [])
    byMonth.get(mi)!.push(s)
  }

  for (const [mi, monthSubs] of byMonth) {
    // Состав месяца: живые + штатно закрытые СОСТОЯВШИЕСЯ (есть отметки).
    // Закрытый без единой отметки (например, cron закрытия неоплаченных) —
    // аннулирован и состав не пополняет.
    const roster = monthSubs.filter(
      (s) =>
        s.status === "pending" ||
        s.status === "active" ||
        (s.status === "closed" && (attendedBySub.get(s.id) ?? 0) > 0),
    )

    // t1MinMonth = null, если шаблон выключен или ещё не включался.
    const t1ActiveForMonth = !!t1 && t1MinMonth != null && mi >= t1MinMonth
    let exemptId: string | null = null
    if (t1ActiveForMonth && roster.length > 1) {
      // Самый дорогой по totalAmount; при равенстве освобождается более ранний.
      const sorted = [...roster].sort((a, b) => {
        const c = new Prisma.Decimal(b.totalAmount).comparedTo(new Prisma.Decimal(a.totalAmount))
        if (c !== 0) return c
        const byDate = a.createdAt.getTime() - b.createdAt.getTime()
        if (byDate !== 0) return byDate
        return a.id.localeCompare(b.id)
      })
      exemptId = sorted[0].id
    }

    for (const sub of monthSubs) {
      if (sub.status !== "pending" && sub.status !== "active") continue
      if (sub.discountSource === "legacy") continue

      const shouldHaveType1 = t1ActiveForMonth && roster.length > 1 && sub.id !== exemptId

      if (shouldHaveType1) {
        // Уже выданную тип-1-скидку не пересчитываем (изменение размера
        // шаблона не трогает выданные).
        if (sub.discountSource === "type1") continue
        // source=type2 при снятом выборе («Без скидки») — заменяем на тип 1;
        // если выбор ещё стоит (легаси/недоступный шаблон) — скидка доживает.
        if (sub.discountSource === "type2" && client.discountTemplateId !== null) continue
        await setDiscount(sub, { tpl: t1!, source: "type1" })
      } else {
        // Снятие типа 2 — только когда клиент явно вернул «Без скидки».
        if (sub.discountSource === "type2") {
          if (client.discountTemplateId === null) await setDiscount(sub, null)
          continue
        }
        // Выданные тип-1-скидки снимаем ТОЛЬКО когда тип 1 действует для
        // месяца, но инвариант состава нарушен (стал самым дорогим / в месяце
        // остался один абонемент). При выключенном шаблоне или вне зоны
        // activatedAt выданные скидки доживают (§7 спеки).
        if (sub.discountSource === "type1" && t1ActiveForMonth) {
          await setDiscount(sub, null)
        }
      }
    }
  }

  return result
}

/**
 * Разовый пересчёт после включения тоггла типа 1: все клиенты тенанта с
 * абонементами будущих месяцев (продлённые заранее получают скидку сразу).
 * Вызывать ПОСЛЕ установки isActive=true + activatedAt.
 */
export async function recalcAllClientsForType1(
  db: PrismaClient,
  tenantId: string,
  createdBy?: string | null,
): Promise<number> {
  const now = new Date()
  const nextMonthIdx = monthIndex(now.getFullYear(), now.getMonth() + 1) + 1
  const nextYear = Math.floor(nextMonthIdx / 12)
  const nextMonth = (nextMonthIdx % 12) + 1

  const rows = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      type: { not: "package" },
      status: { in: ["pending", "active"] },
      OR: [
        { periodYear: { gt: nextYear } },
        { periodYear: nextYear, periodMonth: { gte: nextMonth } },
      ],
    },
    select: { clientId: true },
    distinct: ["clientId"],
  })

  let processed = 0
  for (const { clientId } of rows) {
    await db.$transaction(async (tx) => {
      await recalcClientDiscounts(tx, { tenantId, clientId, createdBy })
    })
    processed++
  }
  return processed
}
