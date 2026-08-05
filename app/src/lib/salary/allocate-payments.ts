// Общая аллокация зарплатных выплат по строкам начислений — используется и
// карточкой инструктора (lib/salary/instructor-detail.ts), и автозаполнением
// документа выплат (api/salary-payments/accruals). Держим в одном месте, чтобы
// разбивка остатка в обоих местах CRM совпадала (расхождение уже приводило к багу).
//
// Правила:
//  1. Прямые выплаты по направлению (directionId != null) гасят начисление
//     своего направления.
//  2. Выплаты без направления (directionId == null) гасят СНАЧАЛА строку оклада
//     (по okladDirectionId — направлению оклада окладника, в т.ч. null), затем
//     каскадом прочие null-направленческие начисления; излишек → «Премии−штрафы»
//     (adjPaidNoDirection). Так аванс окладника уменьшает остаток строки оклада,
//     где бы она ни была (с направлением или без), а не «теряется».
//  3. Направленческие выплаты по направлению БЕЗ начислений в периоде (осиротевшие
//     — например, занятие удалено/перенесено после выплаты) не привязываются ни к
//     одной строке начислений — возвращаются отдельно (orphans), чтобы вызывающий
//     показал их отдельными строками и сохранил инвариант
//     Σ остаток_по_строкам == общий остаток.

export const NO_DIR = "__no_direction__"

const r2 = (n: number) => Math.round(n * 100) / 100
const rowKeyOf = (dirId: string | null) => dirId ?? NO_DIR

export interface AllocInput {
  /** Строки начислений периода (оклад + сделка), по одной на направление. */
  accruals: { directionId: string | null; accrued: number }[]
  /** Выплаты по направлению: ключ — НЕнулевой directionId, значение — сумма. */
  paidByDir: Map<string, number>
  /** Сумма всех выплат без направления (directionId == null). */
  paidNoDirection: number
  /**
   * Направление оклада окладника (может быть null — оклад «Без направления»).
   * undefined — сотрудник НЕ окладник: приоритетного поглощения оклад-строкой нет
   * (выплаты без направления всё равно каскадят в null-начисления, если они есть).
   */
  okladDirectionId?: string | null
}

export interface AllocResult {
  /** Итоговая выплата, отнесённая к строке начисления (ключ = directionId ?? NO_DIR). */
  paidByRow: Map<string, number>
  /** Направленческие выплаты без строки начисления в периоде. */
  orphans: { directionId: string; paid: number }[]
  /** Выплаты без направления, не поглощённые окладом/null-начислениями → премии−штрафы. */
  adjPaidNoDirection: number
}

export function allocateSalaryPayments(input: AllocInput): AllocResult {
  const { accruals, paidByDir, paidNoDirection, okladDirectionId } = input

  const accrualKeys = new Set(accruals.map((a) => rowKeyOf(a.directionId)))
  const paidByRow = new Map<string, number>()

  // 1. Прямые выплаты по направлению.
  for (const a of accruals) {
    const direct = a.directionId == null ? 0 : (paidByDir.get(a.directionId) || 0)
    paidByRow.set(rowKeyOf(a.directionId), direct)
  }

  // 2. Выплаты без направления: оклад-строка первой, затем прочие null-строки.
  let budget = paidNoDirection
  const order: string[] = []
  if (okladDirectionId !== undefined) {
    const k = rowKeyOf(okladDirectionId)
    if (accrualKeys.has(k)) order.push(k)
  }
  for (const a of accruals) {
    if (a.directionId == null) {
      const k = rowKeyOf(null)
      if (!order.includes(k)) order.push(k)
    }
  }
  for (const k of order) {
    if (budget <= 0) break
    const a = accruals.find((x) => rowKeyOf(x.directionId) === k)!
    const capacity = Math.max(0, a.accrued - (paidByRow.get(k) || 0))
    const absorb = Math.min(budget, capacity)
    paidByRow.set(k, r2((paidByRow.get(k) || 0) + absorb))
    budget = r2(budget - absorb)
  }
  const adjPaidNoDirection = r2(budget)

  // 3. Осиротевшие направленческие выплаты (нет строки начисления в периоде).
  const orphans: { directionId: string; paid: number }[] = []
  for (const [dirId, paid] of paidByDir) {
    if (!accrualKeys.has(dirId)) orphans.push({ directionId: dirId, paid: r2(paid) })
  }

  return { paidByRow, orphans, adjPaidNoDirection }
}
