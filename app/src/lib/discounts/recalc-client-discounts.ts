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
import { consumedTypeWhereFor } from "@/lib/subscriptions/consumed-lessons"

type Tx = Prisma.TransactionClient | PrismaClient

export const TYPE1_SYSTEM_KEY = "second_subscription"

export interface RecalcDiscountsInput {
  tenantId: string
  clientId: string
  createdBy?: string | null
  /** Только что созданные абонементы — единственные получатели типа 2. */
  newSubscriptionIds?: string[]
  /**
   * Явный per-client свитч на «авто» (PATCH карточки клиента): тип 1 применяется
   * к абонементам ТЕКУЩЕГО месяца, минуя гейт «со следующего месяца после
   * включения тумблера» (activatedAt+1). Гейт задуман против массового движения
   * денег при глобальном включении тумблера — он остаётся для всех прочих
   * триггеров (recalcAllClientsForType1, создание/отчисление/крон/массовая
   * выписка), но осознанное переключение конкретного клиента на «авто» должно
   * подхватывать «за второй абонемент» и в текущем месяце (решение владельца
   * 21.07.2026: иначе снятие ручной/постоянной скидки вешает долг на оплаченный
   * абонемент, а тип 1 не подставляется — кейс Бабюк/Волковой и др. на Dream).
   * Бутстрап: как только тип 1 применён к текущему месяцу, дальше инвариант
   * держится сам через monthHasType1 (см. ниже) — флаг больше не нужен.
   */
  type1CoversCurrentMonth?: boolean
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

/** Число «использованных» занятий: списывающие отметки (включая бесплатные при
 *  100% скидке), а для календарных абонементов — ещё и финальные несписывающие
 *  (Уваж. пропуск, Перерасчёт): клиент за них не платит, слот израсходован —
 *  иначе абонемент вечно ждёт оплату пропущенного занятия (фантомный долг).
 *  Заглушки isPending не считаются. */
export async function countAttendedLessons(
  t: Tx,
  tenantId: string,
  subscriptionId: string,
  subType: string,
): Promise<number> {
  return t.attendance.count({
    where: {
      tenantId,
      subscriptionId,
      isPending: false,
      attendanceType: consumedTypeWhereFor(subType),
    },
  })
}

/** Скидка за занятие по шаблону, ограниченная ценой занятия (занятие не дешевле 0). */
export function perLessonByTemplate(
  tpl: { valueType: "percent" | "fixed"; value: Prisma.Decimal | number | string },
  lessonPrice: Prisma.Decimal,
): Prisma.Decimal {
  const raw =
    tpl.valueType === "percent"
      ? lessonPrice.mul(new Prisma.Decimal(tpl.value)).div(100)
      : new Prisma.Decimal(tpl.value)
  if (raw.lessThanOrEqualTo(0)) return new Prisma.Decimal(0)
  return raw.greaterThan(lessonPrice) ? new Prisma.Decimal(lessonPrice) : raw
}

/**
 * Вариант A — симметрия пересчёта. Сколько долга АКТИВНОГО абонемента докрыть с
 * баланса родителя после пересчёта: пересчёт возвращает переплату на баланс, но
 * недоплату вешает долгом и обратно НИКОГДА не дотягивает — у предоплаченного
 * клиента это давало фантомный долг при живом плюсе на балансе (кейс Арискиной
 * и др. на Dream, 22.07.2026). Гасим до доступного плюса; pending НЕ трогаем —
 * там долг = «ждём оплату», молча списывать с баланса нельзя. Чистая функция.
 */
export function debtCoverageFromBalance(
  status: string,
  newBalance: Prisma.Decimal,
  clientBalance: Prisma.Decimal,
): Prisma.Decimal {
  if (status !== "active") return new Prisma.Decimal(0)
  // greaterThan(0), НЕ isPositive(): у Prisma.Decimal isPositive() истинно и для
  // нуля (знак ≥ 0), из-за чего покрытие срабатывало на нулевом долге/балансе.
  if (newBalance.lessThanOrEqualTo(0) || clientBalance.lessThanOrEqualTo(0)) {
    return new Prisma.Decimal(0)
  }
  return Prisma.Decimal.min(newBalance, clientBalance)
}

/**
 * Денежный пересчёт абонемента под заданную скидку за занятие:
 * finalAmount = снимок списаний + остаток × эффективная цена; переплата →
 * возврат на баланс (discount_refund) + сторно-платёж; недоплата → долг.
 *
 * attended — израсходованные занятия (для календарных включая финальные
 * несписывающие: Уваж. пропуск/Перерасчёт). consumedNoCharge — сколько из них
 * израсходовано БЕЗ списания: их номинал вычитается из discountAmount, чтобы
 * прощённые пропуски не отображались «скидкой» в отчётах.
 * Возвращает сумму возврата.
 */
async function recomputeMoney(
  t: Tx,
  input: {
    tenantId: string
    sub: SubMoney
    attended: number
    consumedNoCharge: number
    perLesson: Prisma.Decimal
    source: "none" | "type1" | "type2" | "legacy"
    createdBy?: string | null
  },
): Promise<Prisma.Decimal> {
  const { tenantId, sub, attended, consumedNoCharge, perLesson, source, createdBy } = input
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
      // Комментарий нейтральный: сюда попадают и пересчёт по скидке, и возврат
      // за занятия, израсходованные без списания (Уваж. пропуск/Перерасчёт).
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
          comment: "Возврат по перерасчёту абонемента",
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
        comment: "Возврат по перерасчёту абонемента",
        createdBy,
      })
    }
  }

  // Вариант A (симметрия): если после пересчёта у АКТИВНОГО абонемента остался
  // долг, а у родителя есть деньги на балансе — докрываем долг с баланса (как
  // «Оплатить с баланса»: transfer_in + transfer_to_subscription, мимо кассы и
  // ДДС). Иначе возврат по пересчёту «убегал» на баланс, оставляя фантомный долг
  // при живом плюсе. pending не трогаем (долг = «ждём оплату»).
  if (newBalance.greaterThan(0) && sub.status === "active") {
    const clientRow = await t.client.findUnique({
      where: { id: sub.clientId },
      select: { clientBalance: true },
    })
    const cover = debtCoverageFromBalance(
      sub.status,
      newBalance,
      new Prisma.Decimal(clientRow?.clientBalance ?? 0),
    )
    if (cover.greaterThan(0)) {
      const account = await t.financialAccount.findFirst({
        where: { tenantId, isActive: true, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
      if (account) {
        const payment = await t.payment.create({
          data: {
            tenantId,
            clientId: sub.clientId,
            subscriptionId: sub.id,
            accountId: account.id,
            amount: cover,
            type: "transfer_in",
            method: "bank_transfer",
            date: new Date(),
            comment: "Автопокрытие долга с баланса (пересчёт)",
            createdBy: createdBy ?? null,
          },
          select: { id: true },
        })
        await applyBalanceDelta(t, {
          tenantId,
          clientId: sub.clientId,
          delta: cover.negated(),
          type: "transfer_to_subscription",
          refs: { subscriptionId: sub.id, paymentId: payment.id, directionId: sub.directionId },
          comment: "Автопокрытие долга с баланса (пересчёт)",
          createdBy,
        })
        newBalance = newBalance.minus(cover)
      }
    }
  }

  // discountAmount — только скидочная часть: из разницы с номиналом вычитаем
  // стоимость занятий, израсходованных без списания (Уваж. пропуск/Перерасчёт),
  // иначе пропуски выглядели бы скидкой в отчётах и списке абонементов.
  const forgivenAmount = lessonPrice.mul(consumedNoCharge)
  const pureDiscount = Prisma.Decimal.max(
    new Prisma.Decimal(0),
    new Prisma.Decimal(sub.totalAmount).minus(newFinal).minus(forgivenAmount),
  )

  await t.subscription.update({
    where: { id: sub.id },
    data: {
      discountPerLesson: perLesson,
      discountSource: source,
      finalAmount: newFinal,
      discountAmount: pureDiscount,
      balance: newBalance,
    },
  })

  // Автоактивация: долга не осталось (100% скидка или возврат «доплатил»).
  // Guard: ноль должен быть достигнут деньгами (paid > 0) или бесплатностью
  // занятий (100% скидка), а НЕ прощёнными пропусками — иначе неоплаченный
  // pending, целиком закрытый «Уваж. пропусками», активировался бы и помечал
  // заявку won («Купил» без единой оплаты — та же метрика, что баг #16).
  if (
    sub.status === "pending" &&
    newBalance.lessThanOrEqualTo(0) &&
    (paid.greaterThan(0) || effective.lessThanOrEqualTo(0))
  ) {
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
      type: true,
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
  const attended = await countAttendedLessons(t, input.tenantId, sub.id, sub.type)
  // Из израсходованных — со списанием: разница даёт «прощённые» занятия
  // (Уваж. пропуск/Перерасчёт), их номинал не должен попадать в discountAmount.
  const charged = await t.attendance.count({
    where: {
      tenantId: input.tenantId,
      subscriptionId: sub.id,
      isPending: false,
      attendanceType: { chargesSubscription: true },
    },
  })
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
    consumedNoCharge: Math.max(0, attended - charged),
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
    select: { id: true, discountTemplateId: true, autoDiscountDisabled: true },
  })
  if (!client) return result

  // Тип 2: выбранный в карточке permanent-шаблон (не легаси). Грузим и
  // выключенный: «выключение шаблона — выданные скидки доживают», поэтому
  // выключенный, но выбранный шаблон блокирует любые изменения скидок клиента.
  // Баг #50: при запрете автоскидок шаблон типа 2 игнорируем (даже если он
  // по какой-то причине остался выбран) — клиент уходит в ветку снятия скидок ниже.
  const t2Row =
    client.discountTemplateId && !client.autoDiscountDisabled
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

  // «Отхожено» по одному запросу на тип абонемента: календарные считают и
  // финальные несписывающие отметки (Уваж. пропуск/Перерасчёт расходуют слот),
  // пакетные — только списывающие (пропуск занятие пакета не сжигает).
  const attendedBySub = new Map<string, number>()
  for (const [ids, subType] of [
    [calendarSubs.map((s) => s.id), "calendar"],
    [packageSubs.map((s) => s.id), "package"],
  ] as const) {
    if (ids.length === 0) continue
    const rows = await t.attendance.groupBy({
      by: ["subscriptionId"],
      where: {
        tenantId: input.tenantId,
        subscriptionId: { in: [...ids] },
        isPending: false,
        attendanceType: consumedTypeWhereFor(subType),
      },
      _count: { _all: true },
    })
    for (const r of rows) attendedBySub.set(r.subscriptionId as string, r._count._all)
  }

  // Списывающие отдельно: разница с израсходованными даёт «прощённые» занятия,
  // чей номинал вычитается из discountAmount в recomputeMoney.
  const allIds = [...calendarSubs, ...packageSubs].map((s) => s.id)
  const chargingBySub = new Map<string, number>()
  if (allIds.length > 0) {
    const rows = await t.attendance.groupBy({
      by: ["subscriptionId"],
      where: {
        tenantId: input.tenantId,
        subscriptionId: { in: allIds },
        isPending: false,
        attendanceType: { chargesSubscription: true },
      },
      _count: { _all: true },
    })
    for (const r of rows) chargingBySub.set(r.subscriptionId as string, r._count._all)
  }

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
      consumedNoCharge: Math.max(0, attended - (chargingBySub.get(sub.id) ?? 0)),
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

  // Баг #50: родитель с явным запретом автоскидок («Без скидки вручную»).
  // Ни тип 1, ни тип 2 не действуют и не применяются к новым абонементам.
  // Уже выданные скидки (тип 1/тип 2) снимаются с ОСТАВШИХСЯ занятий — прошлые
  // списания остаются снимком. Легаси-скидки заморожены и не трогаются.
  // Разовые скидки-бонусы на баланс — отдельный механизм, здесь не затрагиваются.
  if (client.autoDiscountDisabled) {
    for (const sub of [...calendarSubs, ...packageSubs]) {
      if (sub.status !== "pending" && sub.status !== "active") continue
      if (sub.discountSource === "type1" || sub.discountSource === "type2") {
        await setDiscount(sub, null)
      }
    }
    return result
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
    // Текущий месяц входит в зону тип-1 сверх гейта activatedAt+1 в двух случаях:
    //  1. type1CoversCurrentMonth — осознанный per-client свитч на «авто» (бутстрап);
    //  2. monthHasType1 — в месяце УЖЕ есть живой тип-1-абонемент (значит инвариант
    //     для этого клиента в этом месяце уже «живой» — держим его дальше без флага:
    //     любой последующий триггер корректно добавит/снимет скидку по составу,
    //     а не заморозит её). Оба требуют, чтобы тип 1 был включён (t1MinMonth != null).
    const monthHasType1 = monthSubs.some(
      (s) =>
        (s.status === "pending" || s.status === "active") &&
        s.discountSource === "type1",
    )
    const t1ActiveForMonth =
      !!t1 &&
      t1MinMonth != null &&
      (mi >= t1MinMonth || input.type1CoversCurrentMonth === true || monthHasType1)
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
 * абонементами в зоне действия скидки (месяцы >= месяц(activatedAt)+1 —
 * заранее выписанные будущие месяцы получают скидку сразу; при включении
 * «с текущего месяца» activatedAt смещён на месяц назад, и зона включает
 * текущий). Вызывать ПОСЛЕ установки isActive=true + activatedAt.
 */
export async function recalcAllClientsForType1(
  db: PrismaClient,
  tenantId: string,
  createdBy?: string | null,
): Promise<number> {
  const t1 = await db.discountTemplate.findFirst({
    where: { tenantId, systemKey: TYPE1_SYSTEM_KEY, isActive: true },
    select: { activatedAt: true },
  })
  if (!t1?.activatedAt) return 0
  const minIdx =
    monthIndex(t1.activatedAt.getFullYear(), t1.activatedAt.getMonth() + 1) + 1
  // Прошедшие месяцы не трогаем в любом случае.
  const now = new Date()
  const fromIdx = Math.max(minIdx, monthIndex(now.getFullYear(), now.getMonth() + 1))
  const fromYear = Math.floor(fromIdx / 12)
  const fromMonth = (fromIdx % 12) + 1

  const rows = await db.subscription.findMany({
    where: {
      tenantId,
      deletedAt: null,
      type: { not: "package" },
      status: { in: ["pending", "active"] },
      OR: [
        { periodYear: { gt: fromYear } },
        { periodYear: fromYear, periodMonth: { gte: fromMonth } },
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
