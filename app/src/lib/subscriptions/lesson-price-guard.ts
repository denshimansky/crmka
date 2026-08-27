import { Prisma } from "@prisma/client"
import {
  directionPriceAt,
  toUtcDay,
  type DirectionPriceVersionInput,
} from "./direction-price"

/**
 * Гард против «двойной скидки» (кейс: 23 абонемента ДЦ «Умный Я», июнь–авг 2026).
 *
 * Инвариант: `lessonPrice` — это НОМИНАЛЬНАЯ цена занятия; скидки живут отдельно
 * (`discountPerLesson`, эффективная = `lessonPrice − discountPerLesson`). Если в
 * `lessonPrice` кладут уже сниженную цену (номинал − скидка), а сверху авто-скидка
 * («за второй»/пер-абонементная) применяется ещё раз, занятие считается −2×скидки.
 *
 * Здесь — проверка для СОЗДАНИЯ (POST /api/subscriptions): если после применения
 * авто-скидки цена занятия оказалась НИЖЕ базовой цены направления на дату старта,
 * значит в запросе прислали пред-сниженную цену. Для правки цены (PATCH) действует
 * более простой дрейф-устойчивый инвариант — снижать номинал при живой авто-скидке
 * нельзя (проверяется прямо в роуте, сравнением с текущей ценой абонемента).
 */
export class PreDiscountedPriceError extends Error {
  constructor(public base: number, public price: number) {
    super("pre_discounted_lesson_price")
  }
}

/** Базовая (номинальная) цена занятия направления на дату старта абонемента. */
export async function resolveDirectionBasePrice(
  tx: Prisma.TransactionClient,
  tenantId: string,
  directionId: string,
  startDate: Date,
): Promise<number | null> {
  const direction = await tx.direction.findFirst({
    where: { id: directionId, tenantId },
    select: { lessonPrice: true, packagePrices: true },
  })
  if (!direction) return null
  const versions = await tx.directionPrice.findMany({
    where: { directionId, tenantId, deletedAt: null, appliedAt: null },
    select: {
      effectiveFrom: true,
      lessonPrice: true,
      packagePrices: true,
      appliedAt: true,
      deletedAt: true,
    },
  })
  return directionPriceAt(
    direction,
    versions as DirectionPriceVersionInput[],
    toUtcDay(startDate),
  ).lessonPrice
}
