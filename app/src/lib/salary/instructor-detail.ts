// Чистая агрегация детализации ЗП преподавателя за период. Без БД — для юнит-тестов
// и переиспользования в GET /api/salary/instructor/[id].
//
// Семантика: начисления (Attendance.instructorPayAmount) разносятся по направлению
// занятия; «до 15-го» — занятия с днём <= 15 (пресет аванса). Выплаты берутся из
// SalaryPaymentItem: per-direction по directionId, прочие (legacy/простые) — в
// строку «Премии−штрафы» (paidNoDirection). Окладник добавляется строкой по
// defaultDirection: accrued = оклад, accruedFirstHalf = половина оклада.

import { allocateSalaryPayments, NO_DIR } from "./allocate-payments"

export interface AttendanceInput {
  lessonId: string
  date: Date
  groupName: string
  directionId: string | null
  directionName: string
  typeName: string
  instructorPayAmount: number
}

export interface AdjustmentInput {
  id?: string
  type: "bonus" | "penalty"
  amount: number
  /** Причина (комментарий выплаты/корректировки) — показывается строкой в карточке. */
  comment?: string | null
  createdAt?: Date
}

// Строка расшифровки «Премии − штрафы»: одна корректировка = одна строка, чтобы
// в карточке было видно, за что начислено/удержано, а не только итоговая сумма.
// type="payment" — техстрока излишка выплаты без направления (выплатили больше,
// чем начислено оклада/премий): начисления нет, только «Выплачено».
export interface AdjustmentDetail {
  id: string | null
  type: "bonus" | "penalty" | "payment"
  /** Знаковая сумма в столбец «Начислено»: премия +, штраф −, излишек выплаты 0. */
  amount: number
  comment: string | null
  /** Корректировку создала система (комментарий с меткой), а не человек. */
  isAuto: boolean
  createdAt: string | null
  paid: number
  remaining: number
}

// Направленная премия/депремирование (сдельная): складывается в начисление своего
// направления (bonus +, penalty −), чтобы выплата премии позицией с этим directionId
// сходилась с остатком строки. Начисления «до 15-го» премия не меняет.
export interface DirectionAdjustmentInput {
  directionId: string
  directionName: string
  type: "bonus" | "penalty"
  amount: number
}

export interface PaymentItemInput {
  directionId: string | null
  amount: number
  // Имя направления выплаты — нужно, чтобы показать осиротевшие выплаты (по
  // направлению без начислений в периоде) отдельной строкой с названием.
  directionName?: string | null
}

export interface SalariedInput {
  monthlySalary: number
  defaultDirectionId: string | null
  defaultDirectionName: string
}

export interface DirectionDetail {
  directionId: string | null
  directionName: string
  accrued: number
  accruedFirstHalf: number
  paid: number
  remaining: number
  lessonCount: number
}

export interface LessonDetail {
  lessonId: string
  date: string // yyyy-MM-dd
  groupName: string
  directionId: string | null
  directionName: string
  typeName: string
  studentsCharged: number
  amount: number
}

export interface InstructorSalaryDetail {
  byDirection: DirectionDetail[]
  adjustments: {
    bonuses: number
    penalties: number
    net: number
    paidNoDirection: number
    remaining: number
    /** Построчная расшифровка; Σ amount == net, Σ paid == paidNoDirection. */
    items: AdjustmentDetail[]
  }
  lessons: LessonDetail[]
  totals: {
    accrued: number
    accruedFirstHalf: number
    bonuses: number
    penalties: number
    paid: number
    remaining: number
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function buildInstructorSalaryDetail(params: {
  attendances: AttendanceInput[]
  adjustments: AdjustmentInput[]
  paymentItems: PaymentItemInput[]
  salaried: SalariedInput | null
  // Направленные премии/штрафы (сдельные) — складываются в строку своего направления.
  // Ненаправленные корректировки идут через `adjustments` (строка «Премии − штрафы»).
  directionAdjustments?: DirectionAdjustmentInput[]
}): InstructorSalaryDetail {
  const { attendances, adjustments, paymentItems, salaried, directionAdjustments } = params

  // --- Начисления по направлениям + множество занятий ---
  type Acc = { directionId: string | null; directionName: string; accrued: number; accruedFirstHalf: number; lessons: Set<string> }
  const byDir = new Map<string, Acc>()
  const getAcc = (id: string | null, name: string): Acc => {
    const key = id ?? NO_DIR
    let a = byDir.get(key)
    if (!a) { a = { directionId: id, directionName: name, accrued: 0, accruedFirstHalf: 0, lessons: new Set() }; byDir.set(key, a) }
    return a
  }

  for (const a of attendances) {
    const acc = getAcc(a.directionId, a.directionName)
    acc.accrued += a.instructorPayAmount
    if (a.date.getUTCDate() <= 15) acc.accruedFirstHalf += a.instructorPayAmount
    acc.lessons.add(a.lessonId)
  }

  // Окладник: оклад на defaultDirection; половина — в «до 15-го».
  if (salaried && salaried.monthlySalary > 0) {
    const acc = getAcc(salaried.defaultDirectionId, salaried.defaultDirectionName || "Оклад без направления")
    acc.accrued += salaried.monthlySalary
    acc.accruedFirstHalf += salaried.monthlySalary / 2
  }

  // Направленные премии/штрафы (сдельные) — в начисление своего направления
  // (bonus +, penalty −). В «до 15-го» не входят.
  if (directionAdjustments) {
    for (const da of directionAdjustments) {
      const acc = getAcc(da.directionId, da.directionName)
      acc.accrued += da.type === "bonus" ? da.amount : -da.amount
    }
  }

  // --- Корректировки (нужны до аллокации: премии гасятся выплатой раньше оклада) ---
  const bonuses = adjustments.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0)
  const penalties = adjustments.filter((a) => a.type === "penalty").reduce((s, a) => s + a.amount, 0)
  const net = bonuses - penalties

  // --- Выплаты: per-direction и без направления ---
  const paidByDir = new Map<string, number>()
  let paidNoDirection = 0
  for (const it of paymentItems) {
    if (it.directionId == null) paidNoDirection += it.amount
    else paidByDir.set(it.directionId, (paidByDir.get(it.directionId) || 0) + it.amount)
  }

  // Аллокация выплат по строкам начислений (общий helper — та же логика в
  // api/salary-payments/accruals): прямые по направлению; выплаты без направления
  // гасят строку оклада (по defaultDirectionId, в т.ч. null) и прочие null-начисления;
  // излишек → «Премии−штрафы»; осиротевшие направленческие выплаты (нет начисления
  // в периоде) выносятся отдельными строками, чтобы сходился остаток.
  const alloc = allocateSalaryPayments({
    accruals: Array.from(byDir.values()).map((a) => ({ directionId: a.directionId, accrued: a.accrued })),
    paidByDir,
    paidNoDirection,
    okladDirectionId: salaried && salaried.monthlySalary > 0 ? salaried.defaultDirectionId : undefined,
    netAdjustment: net,
  })
  const adjPaidNoDirection = alloc.adjPaidNoDirection

  // Расшифровка премий/штрафов построчно. Выплата без направления гасит премии
  // по порядку их появления (FIFO); штраф ничего не «выплачивает». Остаток
  // выплаты, не покрытый премиями, выносим техстрокой — иначе Σ по строкам не
  // сойдётся с итогом.
  const adjItems: AdjustmentDetail[] = []
  let payBudget = adjPaidNoDirection
  const orderedAdj = [...adjustments].sort((a, b) => {
    const ta = a.createdAt ? a.createdAt.getTime() : 0
    const tb = b.createdAt ? b.createdAt.getTime() : 0
    return ta - tb
  })
  for (const a of orderedAdj) {
    const signed = a.type === "bonus" ? a.amount : -a.amount
    const paid = a.type === "bonus" ? Math.min(payBudget, a.amount) : 0
    payBudget = r2(payBudget - paid)
    const comment = a.comment?.trim() || null
    adjItems.push({
      id: a.id ?? null,
      type: a.type,
      amount: r2(signed),
      comment,
      isAuto: !!comment && comment.startsWith("[Авто-корректировка]"),
      createdAt: a.createdAt ? a.createdAt.toISOString().slice(0, 10) : null,
      paid: r2(paid),
      remaining: r2(signed - paid),
    })
  }
  if (payBudget > 0.004) {
    adjItems.push({
      id: null,
      type: "payment",
      amount: 0,
      comment: null,
      isAuto: false,
      createdAt: null,
      paid: r2(payBudget),
      remaining: r2(-payBudget),
    })
  }

  // Имена направлений выплат (для осиротевших строк) — из paymentItems.
  const dirNameById = new Map<string, string>()
  for (const it of paymentItems) {
    if (it.directionId && it.directionName) dirNameById.set(it.directionId, it.directionName)
  }

  const byDirection: DirectionDetail[] = Array.from(byDir.values())
    .map((a): DirectionDetail => {
      const paid = alloc.paidByRow.get(a.directionId ?? NO_DIR) || 0
      return {
        directionId: a.directionId,
        directionName: a.directionName,
        accrued: r2(a.accrued),
        accruedFirstHalf: r2(a.accruedFirstHalf),
        paid: r2(paid),
        remaining: r2(a.accrued - paid),
        lessonCount: a.lessons.size,
      }
    })
    // #3: осиротевшие направленческие выплаты (нет начисления в периоде) —
    // отдельной строкой (accrued=0, remaining=−paid), чтобы Σ остатков сходилась.
    .concat(
      alloc.orphans.map((o): DirectionDetail => ({
        directionId: o.directionId,
        directionName: dirNameById.get(o.directionId) ?? "Направление вне периода",
        accrued: 0,
        accruedFirstHalf: 0,
        paid: r2(o.paid),
        remaining: r2(-o.paid),
        lessonCount: 0,
      })),
    )
    .sort((x, y) => y.accrued - x.accrued)

  // --- Занятия (per-lesson) ---
  type L = { lessonId: string; date: Date; groupName: string; directionId: string | null; directionName: string; typeName: string; studentsCharged: number; amount: number }
  const lessonsMap = new Map<string, L>()
  for (const a of attendances) {
    let l = lessonsMap.get(a.lessonId)
    if (!l) {
      l = { lessonId: a.lessonId, date: a.date, groupName: a.groupName, directionId: a.directionId, directionName: a.directionName, typeName: a.typeName, studentsCharged: 0, amount: 0 }
      lessonsMap.set(a.lessonId, l)
    }
    l.studentsCharged += 1
    l.amount += a.instructorPayAmount
  }
  const lessons: LessonDetail[] = Array.from(lessonsMap.values())
    .sort((x, y) => x.date.getTime() - y.date.getTime())
    .map((l) => ({
      lessonId: l.lessonId,
      date: l.date.toISOString().slice(0, 10),
      groupName: l.groupName,
      directionId: l.directionId,
      directionName: l.directionName,
      typeName: l.typeName,
      studentsCharged: l.studentsCharged,
      amount: r2(l.amount),
    }))

  // --- Итоги ---
  // Итоги считаем из СЫРЫХ сумм (до округления по направлениям), чтобы не копить
  // погрешность округления; r2 применяется один раз в конце.
  const accruedTotal = Array.from(byDir.values()).reduce((s, a) => s + a.accrued, 0)
  const accruedFirstHalfTotal = Array.from(byDir.values()).reduce((s, a) => s + a.accruedFirstHalf, 0)
  const paidTotal = paymentItems.reduce((s, it) => s + it.amount, 0)

  return {
    byDirection,
    adjustments: {
      bonuses: r2(bonuses),
      penalties: r2(penalties),
      net: r2(net),
      // Выплаты без направления сверх оклада/null-начислений — то, что относится
      // к премиям (оклад уже поглотил свою часть в byDirection выше).
      paidNoDirection: r2(adjPaidNoDirection),
      remaining: r2(net - adjPaidNoDirection),
      items: adjItems,
    },
    lessons,
    totals: {
      accrued: r2(accruedTotal),
      accruedFirstHalf: r2(accruedFirstHalfTotal),
      bonuses: r2(bonuses),
      penalties: r2(penalties),
      paid: r2(paidTotal),
      remaining: r2(accruedTotal + bonuses - penalties - paidTotal),
    },
  }
}
