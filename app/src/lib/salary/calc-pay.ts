import { Prisma, type PrismaClient } from "@prisma/client"
import type { ResolvedRate } from "./resolve-rate"

type DB = PrismaClient | Prisma.TransactionClient

export interface CalcPayInput {
  rate: ResolvedRate
  lessonId: string
  /** Tenant id для всех запросов внутри расчёта (per_lesson/floating/percent). */
  tenantId: string
  /** Клиент текущей отметки — нужен чтобы исключить себя из подсчёта «уже отмеченных». */
  currentClientId: string
  /** Сумма списания с абонемента ТЕКУЩЕЙ отметки (для percent_of_payments). */
  currentChargeAmount: Prisma.Decimal | number
}

/**
 * Считает сумму ЗП инструктора за конкретную отметку посещения.
 *
 * Семантика по схемам:
 *   per_student           — фикс за каждого пришедшего ученика (ratePerStudent).
 *   per_lesson            — фикс за занятие; выплачивается только на ПЕРВУЮ
 *                           платную отметку, остальные = 0 (чтобы не дублировать).
 *   fixed_plus_per_student— исторически то же что per_student (UI отдельно
 *                           показывает «фикс за выход» как информацию).
 *   percent_of_payments   — процент от currentChargeAmount (списание этого ученика).
 *   floating_by_students  — плавающая матрица «N учеников → ставка за занятие».
 *                           Берём bracket по текущему количеству платных
 *                           отметок. Выплачивается только на ПЕРВУЮ отметку.
 *
 * Возвращает Decimal — сохраняется в Attendance.instructorPayAmount.
 */
export async function calcPay(
  db: DB,
  input: CalcPayInput,
): Promise<Prisma.Decimal> {
  const { rate, lessonId, tenantId, currentClientId, currentChargeAmount } = input
  const zero = new Prisma.Decimal(0)

  switch (rate.scheme) {
    case "per_student": {
      return rate.ratePerStudent ?? zero
    }

    case "fixed_plus_per_student": {
      // Историческая совместимость: ставка хранилась только в ratePerStudent,
      // компонент «фикс за выход» отображается в UI ставки, но в расчёт
      // ЗП за конкретную отметку не входил. Сохраняем поведение.
      return rate.ratePerStudent ?? zero
    }

    case "per_lesson": {
      if (!rate.ratePerLesson) return zero
      const existing = await db.attendance.count({
        where: {
          tenantId,
          lessonId,
          instructorPayEnabled: true,
          instructorPayAmount: { gt: 0 },
          clientId: { not: currentClientId },
        },
      })
      return existing === 0 ? rate.ratePerLesson : zero
    }

    case "percent_of_payments": {
      if (!rate.percentOfPayments) return zero
      const charge = new Prisma.Decimal(currentChargeAmount)
      if (charge.lte(0)) return zero
      return charge.mul(rate.percentOfPayments).div(100)
    }

    case "floating_by_students": {
      if (rate.brackets.length === 0) return zero
      // Количество фактических платных отметок на занятии после добавления этой.
      const existingPaidCount = await db.attendance.count({
        where: {
          tenantId,
          lessonId,
          instructorPayEnabled: true,
          attendanceType: { partOfFact: true },
          clientId: { not: currentClientId },
        },
      })
      const presentCount = existingPaidCount + 1
      // Берём bracket с максимальным minStudents <= presentCount.
      const matched = [...rate.brackets]
        .filter((b) => b.minStudents <= presentCount)
        .sort((a, b) => b.minStudents - a.minStudents)[0]
      if (!matched) return zero
      // По аналогии с per_lesson — платим только на первой платной отметке,
      // чтобы вся ставка за занятие не множилась на учеников.
      const existingAny = await db.attendance.count({
        where: {
          tenantId,
          lessonId,
          instructorPayEnabled: true,
          instructorPayAmount: { gt: 0 },
          clientId: { not: currentClientId },
        },
      })
      return existingAny === 0 ? matched.ratePerLesson : zero
    }

    default:
      return zero
  }
}
