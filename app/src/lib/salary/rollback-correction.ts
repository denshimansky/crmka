import { Prisma, type PrismaClient } from "@prisma/client"

type DB = PrismaClient | Prisma.TransactionClient

export interface RollbackCorrectionInput {
  tenantId: string
  /** Кому начислялась ЗП за эту отметку (с учётом замены). */
  employeeId: string
  /** Дата исходного занятия (для определения периода). */
  lessonDate: Date
  /** Сумма ЗП, которая откатывается (положительная, в ₽). */
  amount: Prisma.Decimal | number
  createdBy?: string | null
  /** Поясняющий комментарий (попадает в SalaryAdjustment.comment). */
  comment?: string
}

/**
 * Ф-аудит/корректировка ЗП при откате отметки.
 *
 * Контекст: педагогу могла быть уже выплачена ЗП по периоду занятия
 * (SalaryPayment с employeeId+period). Если в этой выплате участвовала
 * сумма из удаляемой/откатываемой отметки — после её снятия `accrued`
 * уменьшится, а `paid` останется прежним → в отчёте «Зарплата» возникает
 * отрицательный остаток (переплата), который никто никогда не закроет.
 *
 * Решение: создаём SalaryAdjustment(type=bonus) в том же периоде на сумму
 * откатанной ЗП. Бизнес-смысл: «компенсация: занятие удалено после выплаты,
 * деньги уже у педагога — учли как премию, чтобы баланс сошёлся».
 *
 * Используем existing enum `bonus` (без миграции), но в comment явно помечаем
 * `[Авто-корректировка]` — это видно владельцу в /salary → корректировки.
 *
 * Возвращает true, если adjustment создан; false, если выплаты за период
 * не было — отмена «чистая», компенсация не нужна.
 */
export async function maybeRollbackPaidSalary(
  tx: DB,
  input: RollbackCorrectionInput,
): Promise<boolean> {
  const amount = new Prisma.Decimal(input.amount)
  if (amount.lte(0)) return false

  const periodYear = input.lessonDate.getFullYear()
  const periodMonth = input.lessonDate.getMonth() + 1

  // Была ли выплата по этому периоду этому педагогу? Любая, даже частичная.
  const payment = await tx.salaryPayment.findFirst({
    where: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      periodYear,
      periodMonth,
    },
    select: { id: true },
  })
  if (!payment) return false

  await tx.salaryAdjustment.create({
    data: {
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      type: "bonus",
      amount,
      periodYear,
      periodMonth,
      comment: `[Авто-корректировка] ${input.comment || "Откат отметки после выплаты ЗП"}`,
      createdBy: input.createdBy ?? null,
    },
  })
  return true
}
