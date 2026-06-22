// Чистая агрегация детализации ЗП преподавателя за период. Без БД — для юнит-тестов
// и переиспользования в GET /api/salary/instructor/[id].
//
// Семантика: начисления (Attendance.instructorPayAmount) разносятся по направлению
// занятия; «до 15-го» — занятия с днём <= 15 (пресет аванса). Выплаты берутся из
// SalaryPaymentItem: per-direction по directionId, прочие (legacy/простые) — в
// строку «Премии−штрафы» (paidNoDirection). Окладник добавляется строкой по
// defaultDirection: accrued = оклад, accruedFirstHalf = половина оклада.

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
  type: "bonus" | "penalty"
  amount: number
}

export interface PaymentItemInput {
  directionId: string | null
  amount: number
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
const NO_DIR = "__no_direction__"

export function buildInstructorSalaryDetail(params: {
  attendances: AttendanceInput[]
  adjustments: AdjustmentInput[]
  paymentItems: PaymentItemInput[]
  salaried: SalariedInput | null
}): InstructorSalaryDetail {
  const { attendances, adjustments, paymentItems, salaried } = params

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
    const acc = getAcc(salaried.defaultDirectionId, salaried.defaultDirectionName || "Без направления")
    acc.accrued += salaried.monthlySalary
    acc.accruedFirstHalf += salaried.monthlySalary / 2
  }

  // --- Выплаты: per-direction и без направления ---
  const paidByDir = new Map<string, number>()
  let paidNoDirection = 0
  for (const it of paymentItems) {
    if (it.directionId == null) paidNoDirection += it.amount
    else paidByDir.set(it.directionId, (paidByDir.get(it.directionId) || 0) + it.amount)
  }

  const byDirection: DirectionDetail[] = Array.from(byDir.values())
    .map((a) => {
      const paid = a.directionId == null ? 0 : (paidByDir.get(a.directionId) || 0)
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
    .sort((x, y) => y.accrued - x.accrued)

  // --- Корректировки ---
  const bonuses = adjustments.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0)
  const penalties = adjustments.filter((a) => a.type === "penalty").reduce((s, a) => s + a.amount, 0)
  const net = bonuses - penalties

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
  const accruedTotal = byDirection.reduce((s, d) => s + d.accrued, 0)
  const accruedFirstHalfTotal = byDirection.reduce((s, d) => s + d.accruedFirstHalf, 0)
  const paidTotal = paymentItems.reduce((s, it) => s + it.amount, 0)

  return {
    byDirection,
    adjustments: {
      bonuses: r2(bonuses),
      penalties: r2(penalties),
      net: r2(net),
      paidNoDirection: r2(paidNoDirection),
      remaining: r2(net - paidNoDirection),
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
