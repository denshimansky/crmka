import { z } from "zod"

// Валидация сетки цен тарифа: { "1": 5000, "2": 9000, ... } — итоговая цена в месяц за N филиалов
export const priceTiersSchema = z
  .record(
    z.string().regex(/^[1-9]\d*$/, "Сетка: число филиалов — целое от 1"),
    z.number().min(0, "Сетка: цена не может быть отрицательной"),
  )
  .refine((t) => Object.keys(t).length > 0, "Сетка не может быть пустой")
  .refine((t) => {
    const prices = Object.entries(t)
      .map(([count, price]) => [Number(count), price] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, price]) => price)
    return prices.every((p, i) => i === 0 || p >= prices[i - 1])
  }, "Сетка: итоговая цена не может убывать с ростом числа филиалов")
