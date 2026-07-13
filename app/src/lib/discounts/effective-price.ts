// Скидки v2: эффективная цена занятия абонемента.
// Списание за каждое занятие идёт по цене со скидкой; прошлые списания —
// снимок и не пересчитываются (docs/discounts-v2.md §3).

import { Prisma } from "@prisma/client"

export function effectiveLessonPrice(sub: {
  lessonPrice: Prisma.Decimal | number | string
  discountPerLesson: Prisma.Decimal | number | string
}): Prisma.Decimal {
  const price = new Prisma.Decimal(sub.lessonPrice)
  const discount = new Prisma.Decimal(sub.discountPerLesson ?? 0)
  const eff = price.minus(discount)
  return eff.isNegative() ? new Prisma.Decimal(0) : eff
}

// Разовое посещение: применяется постоянная скидка клиента (kind=permanent,
// шаблон выбран в карточке). Автоскидка «за второй абонемент» — абонементная
// механика в рамках месяца, к разовым не применяется; легаси-шаблоны — тоже.
export function oneOffPriceWithDiscount(
  base: Prisma.Decimal,
  template: {
    kind: string
    isActive: boolean
    isLegacy: boolean
    valueType: string
    value: Prisma.Decimal | number | string
  } | null,
): Prisma.Decimal {
  if (!template || !template.isActive || template.isLegacy || template.kind !== "permanent") {
    return base
  }
  const value = new Prisma.Decimal(template.value)
  const discounted =
    template.valueType === "percent"
      ? base.minus(base.mul(value).div(100)).toDecimalPlaces(2)
      : base.minus(value)
  return discounted.isNegative() ? new Prisma.Decimal(0) : discounted
}
