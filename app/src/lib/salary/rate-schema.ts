import { z } from "zod"

export const bracketSchema = z.object({
  minStudents: z.number().int().min(1).max(50),
  ratePerLesson: z.number().min(0),
})

// Общая схема валидации для SalaryRate (личная) и GroupSalaryRate (групповая).
// directionId есть только у личной ставки — для групповой передаётся undefined.
export const baseRateSchema = z.object({
  scheme: z.enum([
    "per_student",
    "per_lesson",
    "fixed_plus_per_student",
    "percent_of_payments",
    "floating_by_students",
  ]),
  directionId: z.string().uuid().nullable().optional(),
  ratePerStudent: z.number().min(0).nullable().optional(),
  ratePerLesson: z.number().min(0).nullable().optional(),
  fixedPerShift: z.number().min(0).nullable().optional(),
  percentOfPayments: z.number().min(0).max(100).nullable().optional(),
  // Оплата инструктору за пробное занятие: none / paid_only / all.
  trialPayMode: z.enum(["none", "paid_only", "all"]).optional(),
  brackets: z.array(bracketSchema).optional(),
})

export type RateInput = z.infer<typeof baseRateSchema>

// Проверка консистентности: для каждой схемы — обязательные поля.
export function validateForScheme(data: RateInput): string | null {
  switch (data.scheme) {
    case "per_student":
      if (!data.ratePerStudent || data.ratePerStudent <= 0) return "Укажите ставку за ученика"
      return null
    case "per_lesson":
      if (!data.ratePerLesson || data.ratePerLesson <= 0) return "Укажите ставку за занятие"
      return null
    case "fixed_plus_per_student":
      if (!data.ratePerStudent || data.ratePerStudent <= 0) return "Укажите ставку за ученика"
      if (!data.fixedPerShift || data.fixedPerShift <= 0) return "Укажите фикс за выход"
      return null
    case "percent_of_payments":
      if (!data.percentOfPayments || data.percentOfPayments <= 0) return "Укажите процент списания"
      return null
    case "floating_by_students": {
      if (!data.brackets || data.brackets.length === 0) return "Добавьте хотя бы одну строку матрицы"
      const mins = data.brackets.map((b) => b.minStudents)
      if (new Set(mins).size !== mins.length) {
        return "В матрице два порога с одинаковым количеством детей — уберите дубль"
      }
      // Матрица обязана покрывать все количества от 1: иначе занятия с числом
      // детей ниже минимального порога молча дают инструктору 0₽ (решение
      // владельца 10.07.2026). Если за такие занятия платить не нужно —
      // владелец явно указывает ставку 0.
      const minThreshold = Math.min(...mins)
      if (minThreshold > 1) {
        const gap = minThreshold === 2 ? "1 ребёнка" : `1–${minThreshold - 1} детей`
        return `Не заполнена ставка для ${gap}. Матрица должна начинаться с 1 ребёнка — если за такие занятия платить не нужно, укажите ставку 0`
      }
      return null
    }
  }
}
