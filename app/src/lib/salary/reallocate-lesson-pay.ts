import { Prisma, type PrismaClient } from "@prisma/client"
import { resolveRate } from "./resolve-rate"
import { maybeRollbackPaidSalary } from "./rollback-correction"

type DB = PrismaClient | Prisma.TransactionClient

// Реаллокация ЗП занятия для схем «за занятие» (per_lesson) и «плавающая по
// ученикам» (floating_by_students).
//
// Проблема (баг Dream/Easy, 09.07.2026): calcPay считает ЗП один раз в момент
// проставления КОНКРЕТНОЙ отметки, по числу уже отмеченных. Итог зависит от
// порядка кликов: отмечают по одному → брекет фиксируется на пороге (пришло 5,
// начислено по брекету «3»); носителя ставки перемечают/удаляют → ставка
// обнуляется и не переезжает (занятие 0 при полном составе).
//
// Решение: после ЛЮБОЙ мутации отметок занятия пересчитать раскладку целиком —
// начисление должно быть функцией итогового состава, а не порядка кликов:
//   - n — число уникальных учеников (client+ward) с отметкой, за которую
//     инструктору начисляется (галочка «Оплата инструктору» на отметке; её дефолт —
//     колонка «Начисление инструктору» вида посещения). «Был» и оплачиваемый
//     «Прогул» считаются, «Не был»/«Уваж. пропуск»/«Перерасчёт» — нет
//     (решение владельца, 10.07.2026). Дубли отметок не завышают порог;
//   - ставка: per_lesson — ratePerLesson при хотя бы одной оплачиваемой
//     отметке; floating — брекет по n (нет оплачиваемых → 0);
//   - вся ставка на одной отметке-«носителе» (первой по времени отметки) —
//     как и раньше, чтобы сумма занятия не множилась на учеников;
//   - если суммарное начисление занятия уменьшилось, а ЗП за период уже
//     выплачена — net-компенсация через maybeRollbackPaidSalary.
//
// Пробные: занятия isTrial не трогаем вовсе. Пробная ОТМЕТКА (isTrial=true) на
// обычном занятии группы участвует в расчёте, но не модифицируется — её сумма
// управляется /api/trial-lessons (trialPayMode):
//   - оплачиваемый пришедший пробный двигает порог floating (как в calcPay);
//   - пробная отметка с начисленной суммой — уже носитель ставки занятия:
//     обычным отметкам ставка не назначается (иначе 2× ставки за занятие).

export interface PayTargetAttendance {
  id: string
  clientId: string
  wardId: string | null
  /** «Оплата инструктору» на отметке (дефолт — «Начисление инструктору» типа). */
  payEnabled: boolean
  /** Пробная отметка: контекст расчёта (порог/носитель), но не цель апдейта. */
  isTrial: boolean
  /** Текущее начисление — у пробных определяет «ставка уже занята». */
  payAmount: Prisma.Decimal
  /** Момент отметки для выбора носителя (markedAt ?? createdAt). */
  at: Date
}

export interface PayTargetRate {
  scheme: string
  ratePerLesson: Prisma.Decimal | null
  brackets: { minStudents: number; ratePerLesson: Prisma.Decimal }[]
}

/**
 * Целевая раскладка ЗП по НЕ-пробным отметкам занятия. Чистая функция
 * (юнит-тесты). Пробные отметки участвуют как контекст, в результат не входят.
 */
export function computePayTargets(
  rate: PayTargetRate,
  atts: PayTargetAttendance[],
): Map<string, Prisma.Decimal> {
  const zero = new Prisma.Decimal(0)
  const regular = atts.filter((a) => !a.isTrial)
  const targets = new Map<string, Prisma.Decimal>(regular.map((a) => [a.id, zero]))
  if (rate.scheme !== "per_lesson" && rate.scheme !== "floating_by_students") {
    return targets
  }

  // Ставка занятия уже начислена пробной отметке (пробный отмечен первым при
  // trialPayMode=all/paid_only) — второго носителя не назначаем.
  const trialCarrierExists = atts.some(
    (a) => a.isTrial && a.payEnabled && a.payAmount.gt(0),
  )
  if (trialCarrierExists) return targets

  const carrier = [...regular]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .find((a) => a.payEnabled)
  if (!carrier) return targets

  if (rate.scheme === "per_lesson") {
    if (rate.ratePerLesson && rate.ratePerLesson.gt(0)) {
      targets.set(carrier.id, rate.ratePerLesson)
    }
    return targets
  }

  // floating_by_students: порог — уникальные ученики с оплачиваемой отметкой,
  // включая пробных (пробный ребёнок сидел на занятии и двигал брекет и в
  // старой логике calcPay).
  const payableAtts = atts.filter((a) => a.payEnabled)
  const uniqueStudents = new Set(payableAtts.map((a) => `${a.clientId}:${a.wardId ?? ""}`))
  const n = uniqueStudents.size
  const bracket = [...rate.brackets]
    .filter((b) => b.minStudents <= n)
    .sort((a, b) => b.minStudents - a.minStudents)[0]
  if (bracket && bracket.ratePerLesson.gt(0)) {
    targets.set(carrier.id, bracket.ratePerLesson)
  }
  return targets
}

export interface ReallocateLessonPayInput {
  tenantId: string
  lessonId: string
  /**
   * Сумма instructorPayAmount не-пробных отметок занятия ДО мутации (снимок
   * в начале транзакции, lessonPaySnapshot). Нужна для net-компенсации: если
   * начисление занятия уменьшилось после выплаты ЗП, разница закрывается
   * SalaryAdjustment.
   */
  paySumBefore: Prisma.Decimal | number
  createdBy?: string | null
}

export interface ReallocateResult {
  /** true — схема реаллоцируемая, раскладка пересчитана (включая компенсацию). */
  handled: boolean
}

/** Снимок суммы ЗП занятия до мутаций — параметр paySumBefore. */
export async function lessonPaySnapshot(
  tx: DB,
  tenantId: string,
  lessonId: string,
): Promise<Prisma.Decimal> {
  const agg = await tx.attendance.aggregate({
    where: { tenantId, lessonId, isTrial: false, isPending: false },
    _sum: { instructorPayAmount: true },
  })
  return agg._sum.instructorPayAmount ?? new Prisma.Decimal(0)
}

export async function reallocateLessonPay(
  tx: DB,
  input: ReallocateLessonPayInput,
): Promise<ReallocateResult> {
  const { tenantId, lessonId } = input

  const lesson = await tx.lesson.findFirst({
    where: { id: lessonId, tenantId },
    select: {
      date: true,
      groupId: true,
      isTrial: true,
      instructorId: true,
      substituteInstructorId: true,
      group: { select: { directionId: true } },
    },
  })
  if (!lesson || lesson.isTrial) return { handled: false }

  const effectiveInstructorId = lesson.substituteInstructorId || lesson.instructorId
  const rate = await resolveRate(tx, {
    tenantId,
    groupId: lesson.groupId,
    employeeId: effectiveInstructorId,
    directionId: lesson.group.directionId,
  }, new Date(lesson.date))
  if (!rate || (rate.scheme !== "per_lesson" && rate.scheme !== "floating_by_students")) {
    return { handled: false }
  }

  const atts = await tx.attendance.findMany({
    where: { tenantId, lessonId, isPending: false },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      isTrial: true,
      instructorPayEnabled: true,
      instructorPayAmount: true,
      markedAt: true,
      createdAt: true,
    },
  })

  const targets = computePayTargets(
    rate,
    atts.map((a) => ({
      id: a.id,
      clientId: a.clientId,
      wardId: a.wardId,
      payEnabled: a.instructorPayEnabled,
      isTrial: a.isTrial,
      payAmount: a.instructorPayAmount,
      at: a.markedAt ?? a.createdAt,
    })),
  )

  let sumTarget = new Prisma.Decimal(0)
  for (const a of atts) {
    if (a.isTrial) continue // суммы пробных управляет /api/trial-lessons
    const target = targets.get(a.id) ?? new Prisma.Decimal(0)
    sumTarget = sumTarget.add(target)
    if (!target.equals(a.instructorPayAmount)) {
      await tx.attendance.update({
        where: { id: a.id },
        data: { instructorPayAmount: target },
      })
    }
  }

  // Net-компенсация: начисление занятия уменьшилось, а ЗП могла быть выплачена.
  // Считаем по сумме занятия, не по отметке: переезд ставки между отметками —
  // не откат (accrued инструктора не меняется).
  const net = new Prisma.Decimal(input.paySumBefore).sub(sumTarget)
  if (net.gt(0)) {
    await maybeRollbackPaidSalary(tx, {
      tenantId,
      employeeId: effectiveInstructorId,
      lessonDate: new Date(lesson.date),
      amount: net,
      createdBy: input.createdBy ?? null,
      comment: `Пересчёт ЗП занятия от ${new Date(lesson.date).toLocaleDateString("ru-RU")} после изменения отметок`,
    })
  }

  return { handled: true }
}
