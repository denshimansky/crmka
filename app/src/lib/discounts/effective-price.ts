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
