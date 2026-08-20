import { Prisma } from "@prisma/client"
import { resolveRate } from "./resolve-rate"
import { calcPay } from "./calc-pay"

/**
 * ЗП инструктора за пробное занятие — по обычной ставке, через те же
 * resolveRate/calcPay, что и платное занятие.
 *
 * Пробное не списывает с абонемента (`currentChargeAmount = 0`), поэтому схема
 * `percent_of_payments` даёт 0 — платить процентом за бесплатное пробное не с
 * чего. Остальные схемы (за ученика / за занятие / фикс + за ученика /
 * плавающая по числу учеников) считаются как обычно.
 *
 * `instructorPayEnabled = false` (галочка «оплатить» снята или режим «Оплата за
 * пробное» в ставке = «Не платить») → 0 без обращения к ставке.
 *
 * Используется на всех путях отметки пробного: PATCH /api/trial-lessons/[id]
 * (расписание, карточка занятия, сетка посещений) и смена этапа подопечного
 * в PATCH /api/wards/[id] — чтобы сумма не зависела от того, откуда отметили.
 */
export async function computeTrialPay(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string
    lessonId: string
    groupId: string
    clientId: string
    instructorId: string
    directionId: string
    instructorPayEnabled: boolean
    /** Дата занятия — ставка берётся действовавшая на неё (версии ставок). */
    atDate: Date
  },
): Promise<Prisma.Decimal> {
  if (!args.instructorPayEnabled) return new Prisma.Decimal(0)

  const rate = await resolveRate(
    tx,
    {
      tenantId: args.tenantId,
      groupId: args.groupId,
      employeeId: args.instructorId,
      directionId: args.directionId,
    },
    args.atDate,
  )
  if (!rate) return new Prisma.Decimal(0)

  return calcPay(tx, {
    rate,
    lessonId: args.lessonId,
    tenantId: args.tenantId,
    currentClientId: args.clientId,
    currentChargeAmount: 0,
  })
}
