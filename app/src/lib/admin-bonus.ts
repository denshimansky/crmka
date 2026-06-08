import { db } from "@/lib/db"

// Бонусы админов: scope-модель.
//   Global       — (branchId=NULL, employeeId=NULL)
//   Branch X     — (branchId=X,    employeeId=NULL)
//   Employee Y   — (branchId=NULL, employeeId=Y)
// На каждую scope в БД лежит до 3 строк (по одной на bonusType). amount=NULL
// = «использовать default следующего уровня». Лестница defaults — employee →
// branch → global → 0 — будет считаться в момент расчёта мотивации.

export type BonusType = "per_trial" | "per_sale" | "per_upsale"
export type BonusField = "trialBonus" | "saleBonus" | "upsaleBonus"

export const TYPE_TO_FIELD: Record<BonusType, BonusField> = {
  per_trial: "trialBonus",
  per_sale: "saleBonus",
  per_upsale: "upsaleBonus",
}

export const FIELD_TO_TYPE: Record<BonusField, BonusType> = {
  trialBonus: "per_trial",
  saleBonus: "per_sale",
  upsaleBonus: "per_upsale",
}

export const BONUS_TYPES: BonusType[] = ["per_trial", "per_sale", "per_upsale"]

export function emptyAmounts() {
  return {
    trialBonus: null as number | null,
    saleBonus: null as number | null,
    upsaleBonus: null as number | null,
  }
}

/**
 * Upsert одной комбинации (tenantId, branchId, employeeId, bonusType).
 * Без unique-индекса в БД (NULL-семантика отличается между движками) — ищем
 * findFirst → update/create.
 */
export async function upsertScopeBonus(
  tenantId: string,
  branchId: string | null,
  employeeId: string | null,
  bonusType: BonusType,
  amount: number | null,
) {
  const existing = await db.adminBonusSettings.findFirst({
    where: { tenantId, branchId, employeeId, bonusType, isActive: true },
    select: { id: true },
  })
  if (existing) {
    await db.adminBonusSettings.update({
      where: { id: existing.id },
      data: { amount },
    })
    return
  }
  await db.adminBonusSettings.create({
    data: { tenantId, branchId, employeeId, bonusType, amount, isActive: true },
  })
}
