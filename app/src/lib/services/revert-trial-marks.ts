import type { Prisma } from "@prisma/client"
import { recomputeWardSalesStage } from "@/lib/services/ward-sales-stage"
import { recomputeClientFirstPaidLessonDate } from "@/lib/services/client-first-paid-lesson-date"

/** Только внутри транзакции: хелперы пересчёта принимают TransactionClient. */
type Tx = Prisma.TransactionClient

/**
 * Перенос занятия сбрасывает отметки — вернуть в «Не отмечен» надо и пробные.
 *
 * Транзакция переноса (PATCH /api/lessons/[id]) удаляет Attendance пробного и
 * возвращает родителю списание за платное пробное, но саму строку TrialLesson
 * раньше не трогала: пробное оставалось «Пришёл» без единой отметки, заявка
 * висела на этапе «Прошёл пробное», и в воронке ребёнок числился прошедшим
 * пробное, которого больше нет.
 *
 * Здесь — та часть отката, которая НЕ про Attendance и деньги (их переносящая
 * транзакция уже сделала): статус пробного, этап заявки, зеркало
 * Ward.salesStage и агрегат «дата первого платного». Зеркалит ветку сброса
 * отметки в PATCH /api/trial-lessons/[id] (status="scheduled").
 *
 * Сбрасываем только «Пришёл»: у «Не пришёл» отметки и так нет — рассинхрона
 * там не возникает, а стирать зафиксированный администратором факт незачем.
 *
 * Вызывать ПОСЛЕ удаления отметок занятия: recomputeClientFirstPaidLessonDate
 * считает по живым Attendance.
 */
export async function revertAttendedTrialsOnLessonMove(
  tx: Tx,
  params: { tenantId: string; lessonId: string; now?: Date },
): Promise<number> {
  const { tenantId, lessonId } = params
  const now = params.now ?? new Date()

  const trials = await tx.trialLesson.findMany({
    where: { tenantId, lessonId, status: "attended" },
    select: { id: true, clientId: true, wardId: true, applicationId: true },
  })
  if (trials.length === 0) return 0

  await tx.trialLesson.updateMany({
    where: { id: { in: trials.map((t) => t.id) } },
    data: { status: "scheduled", attendedAt: null },
  })

  // Этап заявки откатываем только если у неё не осталось других «Пришёл»
  // пробных (у заявки их может быть несколько — напр. пробные в разные группы).
  const applicationIds = [
    ...new Set(trials.map((t) => t.applicationId).filter((x): x is string => !!x)),
  ]
  for (const applicationId of applicationIds) {
    const otherAttended = await tx.trialLesson.count({
      where: { tenantId, applicationId, status: "attended" },
    })
    if (otherAttended > 0) continue
    await tx.application.updateMany({
      where: { id: applicationId, tenantId, status: "active", stage: "trial_attended" },
      data: { stage: "trial_scheduled" },
    })
  }

  for (const wardId of [
    ...new Set(trials.map((t) => t.wardId).filter((x): x is string => !!x)),
  ]) {
    await recomputeWardSalesStage(tx, tenantId, wardId, now)
  }

  for (const clientId of [...new Set(trials.map((t) => t.clientId))]) {
    await recomputeClientFirstPaidLessonDate(tx, tenantId, clientId)
  }

  return trials.length
}
