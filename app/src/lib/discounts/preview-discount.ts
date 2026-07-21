// Скидки v2: предпросчёт скидки для НОВОГО абонемента (docs/discounts-v2.md).
//
// Read-only зеркало решения recalcClientDiscounts «какая скидка достанется
// создаваемому абонементу» — чтобы форма создания абонемента показывала итоговую
// цену со скидкой, а не только номинал lessonPrice × totalLessons (баг #72:
// показывалось 5200, а создавался абонемент за 4800). НИЧЕГО не мутирует.
//
// Считаем только скидку самого создаваемого абонемента; побочный пересчёт других
// абонементов месяца (перекладывание скидки между ними) остаётся за сервисом.

import { Prisma, type PrismaClient, type DiscountValueType } from "@prisma/client"
import { perLessonByTemplate, TYPE1_SYSTEM_KEY } from "./recalc-client-discounts"
import { consumedTypeWhereFor } from "@/lib/subscriptions/consumed-lessons"

type Db = PrismaClient | Prisma.TransactionClient

export interface DiscountPreview {
  hasDiscount: boolean
  source: "type1" | "type2" | null
  templateName: string | null
  valueType: DiscountValueType | null
  /** Размер скидки шаблона (₽ за занятие для fixed, % для percent). */
  templateValue: number
  discountPerLesson: number
  effectiveLessonPrice: number
  totalAmount: number
  discountAmount: number
  finalAmount: number
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1)
}

function noDiscount(lessonPrice: Prisma.Decimal, totalLessons: number): DiscountPreview {
  const total = lessonPrice.mul(totalLessons)
  return {
    hasDiscount: false,
    source: null,
    templateName: null,
    valueType: null,
    templateValue: 0,
    discountPerLesson: 0,
    effectiveLessonPrice: lessonPrice.toNumber(),
    totalAmount: total.toNumber(),
    discountAmount: 0,
    finalAmount: total.toNumber(),
  }
}

function withDiscount(
  tpl: { name: string; valueType: DiscountValueType; value: Prisma.Decimal },
  lessonPrice: Prisma.Decimal,
  totalLessons: number,
  source: "type1" | "type2",
): DiscountPreview {
  const perLesson = perLessonByTemplate(tpl, lessonPrice)
  // Шаблон с нулевым эффектом (value=0 или процент, дающий 0) — скидки нет.
  if (perLesson.lessThanOrEqualTo(0)) return noDiscount(lessonPrice, totalLessons)
  const effective = lessonPrice.minus(perLesson)
  const total = lessonPrice.mul(totalLessons)
  const finalAmount = effective.mul(totalLessons)
  return {
    hasDiscount: true,
    source,
    templateName: tpl.name,
    valueType: tpl.valueType,
    templateValue: Number(tpl.value),
    discountPerLesson: perLesson.toNumber(),
    effectiveLessonPrice: effective.toNumber(),
    totalAmount: total.toNumber(),
    discountAmount: total.minus(finalAmount).toNumber(),
    finalAmount: finalAmount.toNumber(),
  }
}

/**
 * Какая скидка достанется создаваемому абонементу. Возвращает null, если входные
 * данные некорректны (нет клиента / нулевая цена) — вызывающий трактует как «без
 * предпросчёта». В остальных случаях всегда возвращает DiscountPreview
 * (hasDiscount=false, когда скидки не будет).
 */
export async function previewSubscriptionDiscount(
  db: Db,
  input: {
    tenantId: string
    clientId: string
    type: "calendar" | "package"
    periodYear?: number | null
    periodMonth?: number | null
    lessonPrice: number
    totalLessons: number
  },
): Promise<DiscountPreview | null> {
  const lessonPrice = new Prisma.Decimal(input.lessonPrice)
  const totalLessons = input.totalLessons
  if (lessonPrice.lessThanOrEqualTo(0) || totalLessons <= 0) return null

  const client = await db.client.findFirst({
    where: { id: input.clientId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, discountTemplateId: true, autoDiscountDisabled: true },
  })
  if (!client) return null

  // Явный запрет автоскидок — новый абонемент без скидки (баг #50).
  if (client.autoDiscountDisabled) return noDiscount(lessonPrice, totalLessons)

  // Тип 2 (постоянная скидка из карточки) — приоритетен и эксклюзивен, действует
  // на ЛЮБОЙ новый абонемент, включая пакетный. При выбранном тип-2 тип 1 не действует.
  // Логика зеркалит recalcClientDiscounts:
  //   - активный permanent non-legacy → тип 2;
  //   - выбранный permanent non-legacy, но ВЫКЛЮЧЕННЫЙ → новый без скидки
  //     (выданные доживают, тип 1 не подключается);
  //   - шаблон легаси/неперманент/удалённый → проваливаемся в тип 1.
  if (client.discountTemplateId) {
    const t2 = await db.discountTemplate.findFirst({
      where: {
        id: client.discountTemplateId,
        tenantId: input.tenantId,
        kind: "permanent",
        isLegacy: false,
      },
      select: { name: true, valueType: true, value: true, isActive: true },
    })
    if (t2) {
      return t2.isActive
        ? withDiscount(t2, lessonPrice, totalLessons, "type2")
        : noDiscount(lessonPrice, totalLessons)
    }
    // t2 === null: templateId указывает на легаси/неперманент шаблон — тип 1 ниже.
  }

  // Тип 1 «Скидка за второй абонемент» — только для календарных абонементов.
  if (input.type !== "calendar" || input.periodYear == null || input.periodMonth == null) {
    return noDiscount(lessonPrice, totalLessons)
  }

  const t1 = await db.discountTemplate.findFirst({
    where: { tenantId: input.tenantId, systemKey: TYPE1_SYSTEM_KEY },
    select: { name: true, valueType: true, value: true, isActive: true, activatedAt: true },
  })
  if (!t1?.isActive || t1.activatedAt == null) return noDiscount(lessonPrice, totalLessons)

  // Зона действия: период со СЛЕДУЮЩЕГО месяца после включения; прошедшие не трогаем.
  const targetMonth = monthIndex(input.periodYear, input.periodMonth)
  const t1MinMonth = monthIndex(t1.activatedAt.getFullYear(), t1.activatedAt.getMonth() + 1) + 1
  const now = new Date()
  const currentMonth = monthIndex(now.getFullYear(), now.getMonth() + 1)
  if (targetMonth < t1MinMonth || targetMonth < currentMonth) {
    return noDiscount(lessonPrice, totalLessons)
  }

  // Состав месяца из уже существующих абонементов клиента: живые + штатно закрытые
  // с отметками. Новый абонемент добавит +1. Скидку несут все, кроме самого
  // дорогого по totalAmount (при равенстве освобождается более ранний; новый —
  // самый поздний, поэтому при равенстве цены скидку получает).
  const existing = await db.subscription.findMany({
    where: {
      tenantId: input.tenantId,
      clientId: input.clientId,
      deletedAt: null,
      type: { not: "package" },
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      status: { in: ["pending", "active", "closed"] },
    },
    select: { id: true, status: true, totalAmount: true },
  })

  const closedIds = existing.filter((s) => s.status === "closed").map((s) => s.id)
  const attendedClosed = new Set<string>()
  if (closedIds.length > 0) {
    const rows = await db.attendance.groupBy({
      by: ["subscriptionId"],
      where: {
        tenantId: input.tenantId,
        subscriptionId: { in: closedIds },
        isPending: false,
        attendanceType: consumedTypeWhereFor("calendar"),
      },
      _count: { _all: true },
    })
    for (const r of rows) {
      if (r._count._all > 0) attendedClosed.add(r.subscriptionId as string)
    }
  }

  const roster = existing.filter((s) => s.status !== "closed" || attendedClosed.has(s.id))
  // Новый абонемент — единственный в месяце: тип 1 требует больше одного.
  if (roster.length < 1) return noDiscount(lessonPrice, totalLessons)

  const newTotal = lessonPrice.mul(totalLessons)
  const maxExisting = roster.reduce(
    (m, s) => Prisma.Decimal.max(m, new Prisma.Decimal(s.totalAmount)),
    new Prisma.Decimal(0),
  )
  // Новый строго дороже всех существующих → он «самый дорогой», скидку не несёт
  // (её получат остальные абонементы месяца при пересчёте после создания).
  if (newTotal.greaterThan(maxExisting)) return noDiscount(lessonPrice, totalLessons)

  return withDiscount(t1, lessonPrice, totalLessons, "type1")
}
