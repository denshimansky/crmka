// Расчёт стоимости SaaS-подписки в месяц.
//
// У тарифа может быть сетка priceTiers: { "1": 5000, "2": 9000, ... } —
// итоговая цена в месяц за N филиалов (объёмная скидка).
// Ниже минимальной ступени — цена минимальной; дыра между ступенями —
// линейная интерполяция соседних; сверх максимальной — шаг последней
// ступени (не ниже нуля, чтобы кривая сетка не давала отрицательных сумм).
// Без сетки — линейно: pricePerBranch × branchCount.

export interface PlanPricing {
  pricePerBranch: unknown // Prisma Decimal | string | number
  priceTiers?: unknown // Json из БД
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function parsePriceTiers(raw: unknown): Map<number, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const tiers = new Map<number, number>()
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const count = Number(key)
    const price = Number(value)
    if (Number.isInteger(count) && count >= 1 && Number.isFinite(price) && price >= 0) {
      tiers.set(count, price)
    }
  }
  return tiers.size ? tiers : null
}

export function monthlyPriceFor(plan: PlanPricing, branchCount: number): number {
  const linear = Number(plan.pricePerBranch) * branchCount
  const tiers = parsePriceTiers(plan.priceTiers)
  if (!tiers) return linear

  const exact = tiers.get(branchCount)
  if (exact !== undefined) return exact

  const counts = [...tiers.keys()].sort((a, b) => a - b)
  const min = counts[0]
  const max = counts[counts.length - 1]

  if (branchCount < min) return tiers.get(min)!

  if (branchCount > max) {
    const prev = counts.length > 1 ? counts[counts.length - 2] : null
    const step =
      prev === null
        ? Number(plan.pricePerBranch)
        : (tiers.get(max)! - tiers.get(prev)!) / (max - prev)
    return round2(tiers.get(max)! + Math.max(0, step) * (branchCount - max))
  }

  const lower = counts.filter((c) => c < branchCount).pop()!
  const upper = counts.find((c) => c > branchCount)!
  const share = (branchCount - lower) / (upper - lower)
  return round2(tiers.get(lower)! + (tiers.get(upper)! - tiers.get(lower)!) * share)
}
