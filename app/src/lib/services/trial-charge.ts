import { Prisma } from "@prisma/client"

/**
 * Сумма списания за пробное с баланса родителя. Управляется галкой «Бесплатное
 * пробное» направления: бесплатное → 0, иначе — цена пробного (trialPrice).
 * Живые поля направления, без скидок клиента (решение 26.08.2026, см. спеку
 * docs/superpowers/specs/2026-08-26-paid-trial-charge-design.md).
 */
export function computeTrialCharge(direction: {
  trialFree: boolean | null
  trialPrice: Prisma.Decimal | number | string | null
}): Prisma.Decimal {
  if (direction.trialFree) return new Prisma.Decimal(0)
  return new Prisma.Decimal(direction.trialPrice ?? 0)
}
