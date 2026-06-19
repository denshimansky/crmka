import { Prisma } from "@prisma/client"

/**
 * Пересчитывает агрегат `Client.firstPaidLessonDate` = самая ранняя «дата первого
 * платного занятия» среди детей/заявок родителя.
 *
 * После переноса витринной даты на заявку (Application.firstPaidLessonDate) поле
 * на клиенте остаётся ПАРЕНТ-агрегатом для отчётов (saleDate, отток, конверсия —
 * см. reports-logic.md, data-dictionary.md). Источники самой ранней даты:
 *   1. ручные даты в воронке — Application.firstPaidLessonDate (включая «в долг»),
 *   2. фактическое первое платное посещение — Attendance.chargeAmount > 0.
 *
 * Вызывать внутри транзакции после любой правки Application.firstPaidLessonDate
 * (инлайн в «Продажах», reschedule-start, move-to-awaiting-payment).
 */
export async function recomputeClientFirstPaidLessonDate(
  tx: Prisma.TransactionClient,
  tenantId: string,
  clientId: string,
): Promise<void> {
  const [appAgg, firstPaidAtt] = await Promise.all([
    tx.application.aggregate({
      where: {
        tenantId,
        clientId,
        deletedAt: null,
        firstPaidLessonDate: { not: null },
      },
      _min: { firstPaidLessonDate: true },
    }),
    tx.attendance.findFirst({
      where: { tenantId, clientId, chargeAmount: { gt: 0 } },
      orderBy: { lesson: { date: "asc" } },
      select: { lesson: { select: { date: true } } },
    }),
  ])

  const candidates: Date[] = []
  if (appAgg._min.firstPaidLessonDate) candidates.push(appAgg._min.firstPaidLessonDate)
  if (firstPaidAtt?.lesson?.date) candidates.push(firstPaidAtt.lesson.date)

  const value =
    candidates.length > 0
      ? new Date(Math.min(...candidates.map((d) => d.getTime())))
      : null

  await tx.client.update({
    where: { id: clientId },
    data: { firstPaidLessonDate: value },
  })
}
