import { Prisma, type PrismaClient } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"

type DB = PrismaClient | Prisma.TransactionClient

/**
 * Возврат разового списания при перецепке отметки на абонемент.
 *
 * Разовая отметка (`subscription_id IS NULL`) списывает стоимость занятия с
 * БАЛАНСА родителя (`personal_lesson_charge`, платное пробное — `trial_charge`).
 * Если такую строку потом перецепить на абонемент — типичный случай, когда
 * абонемент выписан задним числом на уже отмеченные даты, — занятие спишется
 * ещё раз, уже с абонемента. Без этого возврата клиент платит ДВАЖДЫ: кейс
 * Вершининой (04.09.2026), два разовых по 1000 ₽ остались висеть на балансе
 * после переотметки, при том что абонемент за те же занятия оплачен полностью.
 *
 * Считаем по ledger, а не по `attendance.chargeAmount`: у импортированных
 * отметок стоимость проставлена без денежных проводок, и слепой возврат
 * нарисовал бы клиенту деньги из воздуха. Семантика источников — как в
 * `lib/one-off-debt.ts`: списание = `personal_lesson_charge` / `trial_charge`,
 * возврат разового = `attendance_revert` без абонемента с положительной суммой
 * (откат частичного `lesson_refund` пишется тем же типом, но отрицательным —
 * знак и разделяет семантики). За счёт вычета уже сделанных возвратов функция
 * идемпотентна: повторный вызов на той же отметке вернёт 0.
 *
 * @returns фактически возвращённая на баланс сумма (0, если возвращать нечего)
 */
export async function revertOneOffChargeForAttendance(
  db: DB,
  input: {
    tenantId: string
    clientId: string
    attendanceId: string
    lessonId: string
    directionId: string
    createdBy: string | null
  },
): Promise<Prisma.Decimal> {
  const { tenantId, clientId, attendanceId } = input

  const [charged, reverted] = await Promise.all([
    db.clientBalanceTransaction.aggregate({
      where: {
        tenantId,
        clientId,
        attendanceId,
        type: { in: ["personal_lesson_charge", "trial_charge"] },
      },
      _sum: { amount: true },
    }),
    db.clientBalanceTransaction.aggregate({
      where: {
        tenantId,
        clientId,
        attendanceId,
        type: "attendance_revert",
        subscriptionId: null,
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    }),
  ])

  const outstanding = new Prisma.Decimal(charged._sum.amount ?? 0)
    .negated()
    .minus(new Prisma.Decimal(reverted._sum.amount ?? 0))

  if (!outstanding.gt(0)) return new Prisma.Decimal(0)

  await applyBalanceDelta(db, {
    tenantId,
    clientId,
    delta: outstanding,
    type: "attendance_revert",
    refs: {
      lessonId: input.lessonId,
      attendanceId,
      directionId: input.directionId,
    },
    createdBy: input.createdBy,
  })

  return outstanding
}
