import { Prisma } from "@prisma/client"

/**
 * Недосписанная (возвратная) часть посещения = lessonPrice * (100 - chargePercent) / 100.
 * При chargePercent=100 (по умолчанию) вернётся 0 — поведение совместимо со старой логикой.
 */
export function calcRefund(
  chargeAmount: Prisma.Decimal | number,
  chargePercent: number,
): Prisma.Decimal {
  const charge = new Prisma.Decimal(chargeAmount)
  if (charge.lte(0) || chargePercent >= 100) return new Prisma.Decimal(0)
  const remaining = Math.max(0, 100 - chargePercent)
  return charge.mul(remaining).div(100)
}
