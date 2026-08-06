// Разделение зарплаты сотрудника на два типа ЗП — «Сдельная» (piece) и «Оклады»
// (salary) — для страницы «Зарплата», карточки инструктора и списка проведённых
// выплат. Чистые функции без БД (юнит-тесты).
//
// В БД тип выплаты НЕ хранится (одна выплата может смешивать оба типа — см.
// SalaryPaymentItem). Атрибуция — ПО НАПРАВЛЕНИЮ строки, договорённость: оклад =
// «без направления» (Employee.defaultDirectionId=null). Правило:
//   • у сотрудника есть оклад (monthlySalary>0): строка «без направления»
//     (directionId=null) → оклад, строки по направлениям → сделка;
//   • оклада нет (monthlySalary=0): ВСЁ → сделка (в т.ч. премии/legacy без
//     направления), окладная вкладка пуста.
// Премии/штрафы (SalaryAdjustment) с directionId!=null → сделка (конкретное
// направление), с directionId=null → оклад (у окладника) либо сделка (у сдельщика).

export type SalaryKind = "piece" | "salary"

export interface PaymentItemLite {
  directionId: string | null
  amount: number
}

export interface AdjustmentLite {
  directionId: string | null
  type: "bonus" | "penalty"
  amount: number
}

export interface TabTotals {
  accrued: number
  bonuses: number
  penalties: number
  paid: number
  remaining: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Тип ЗП, к которому относится сумма «без направления»/по направлению.
 * hasOklad=false → всегда «сделка» (у сдельщика null-деньги = премия/legacy,
 * не оклад). hasOklad=true → null → оклад, направление → сделка.
 */
export function kindOfDirection(directionId: string | null, hasOklad: boolean): SalaryKind {
  if (!hasOklad) return "piece"
  return directionId == null ? "salary" : "piece"
}

/**
 * Разбить начисления/выплаты/корректировки сотрудника за период на две вкладки.
 * Инвариант: piece.X + salary.X == общий X (accrued/bonuses/penalties/paid),
 * поэтому Σ остатков по вкладкам == общий остаток сотрудника.
 */
export function splitEmployeeByKind(input: {
  monthlySalary: number
  /** Σ сделочного начисления по занятиям за период (Attendance.instructorPayAmount). */
  pieceAccrued: number
  paymentItems: PaymentItemLite[]
  adjustments: AdjustmentLite[]
}): { piece: TabTotals; salary: TabTotals } {
  const hasOklad = input.monthlySalary > 0

  let pieceBonuses = 0, piecePenalties = 0, piecePaid = 0
  let okladBonuses = 0, okladPenalties = 0, okladPaid = 0

  for (const it of input.paymentItems) {
    if (kindOfDirection(it.directionId, hasOklad) === "salary") okladPaid += it.amount
    else piecePaid += it.amount
  }
  for (const a of input.adjustments) {
    const toOklad = kindOfDirection(a.directionId, hasOklad) === "salary"
    if (a.type === "bonus") {
      if (toOklad) okladBonuses += a.amount; else pieceBonuses += a.amount
    } else {
      if (toOklad) okladPenalties += a.amount; else piecePenalties += a.amount
    }
  }

  const piece: TabTotals = {
    accrued: r2(input.pieceAccrued),
    bonuses: r2(pieceBonuses),
    penalties: r2(piecePenalties),
    paid: r2(piecePaid),
    remaining: r2(input.pieceAccrued + pieceBonuses - piecePenalties - piecePaid),
  }
  const okladAccrued = hasOklad ? input.monthlySalary : 0
  const salary: TabTotals = {
    accrued: r2(okladAccrued),
    bonuses: r2(okladBonuses),
    penalties: r2(okladPenalties),
    paid: r2(okladPaid),
    remaining: r2(okladAccrued + okladBonuses - okladPenalties - okladPaid),
  }
  return { piece, salary }
}

export interface PayItem {
  directionId: string | null
  amount: number
}

/**
 * Депремирование (штраф) вычитается из суммы выплаты: «К выплате = начислено +
 * премии − штраф». Уменьшаем позиции выплаты на сумму штрафа — сначала по
 * направлению штрафа (`penaltyDirId`), затем каскадом по остальным. Итоговая сумма
 * позиций = max(0, Σ − штраф). Так факт выплаты соответствует, и «Осталось» не уходит
 * в мнимую переплату. Штраф при этом отдельно пишется в SalaryAdjustment (колонка
 * «Штрафы»); двойного вычета нет — «Осталось» = начислено + премии − штраф − выплачено.
 */
export function applyPenaltyToItems(items: PayItem[], penalty: number, penaltyDirId: string | null): PayItem[] {
  let rem = Math.max(0, penalty)
  if (rem <= 0) return items.map((it) => ({ ...it }))
  const key = (d: string | null) => d ?? "__null__"
  // Порядок вычета: сначала позиции направления штрафа, затем остальные.
  const order = items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const am = key(a.it.directionId) === key(penaltyDirId) ? 0 : 1
      const bm = key(b.it.directionId) === key(penaltyDirId) ? 0 : 1
      return am - bm || a.i - b.i
    })
  const out: PayItem[] = []
  for (const { it } of order) {
    if (rem <= 0) { out.push({ ...it }); continue }
    const cut = Math.min(it.amount, rem)
    rem = r2(rem - cut)
    const left = r2(it.amount - cut)
    if (left > 0) out.push({ directionId: it.directionId, amount: left })
  }
  return out
}
