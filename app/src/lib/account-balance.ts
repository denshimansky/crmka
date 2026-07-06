import { z } from "zod"

// Decimal(12,2): 10 знаков в целой части
export const BALANCE_LIMIT = 9_999_999_999.99

/** null/"" → undefined (не задан); строка с запятой → число; boolean/массивы — ошибка валидации */
export const balanceSchema = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return undefined
    if (typeof v === "string") {
      const t = v.trim()
      return t ? Number(t.replace(",", ".")) : undefined
    }
    return v
  },
  z
    .number({ invalid_type_error: "Некорректный остаток" })
    .finite("Некорректный остаток")
    .min(-BALANCE_LIMIT, "Остаток вне допустимого диапазона")
    .max(BALANCE_LIMIT, "Остаток вне допустимого диапазона")
    .optional()
    // до 2 знаков, как в колонке: иначе БД округлит молча и аудит разойдётся с фактом
    // (точно для всего диапазона: |v|*100 < 2^53)
    .transform((v) => (v === undefined ? undefined : Math.round(v * 100) / 100))
)
