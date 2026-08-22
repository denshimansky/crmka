// Архив удалённых занятий: снимок при удалении + восстановление из снимка.
//
// Занятие удаляется физически (DELETE /api/lessons/[id]) — мягкое удаление на
// самой Lesson потребовало бы фильтра deletedAt примерно в 57 местах чтения
// занятий (сетка расписания, отчёты, ЗП, ЛК родителя, задачи, ИИ-контекст), и
// единственный пропуск показал бы «призрак» удалённого занятия там, где его
// быть не должно. Вместо этого перед удалением кладём снимок в deleted_lessons:
// он живёт отдельно и не может протечь ни в один существующий запрос.
//
// Восстановление пересоздаёт занятие (id новый) и возвращает пакетам их выбор.

import type { Prisma, PrismaClient } from "@prisma/client"
import type { DeletedSelectionSnapshot } from "@/lib/tasks/reselect-package-lesson"

type DB = PrismaClient | Prisma.TransactionClient

/** Поля занятия, которые кладём в архив. */
export interface ArchivableLesson {
  id: string
  groupId: string
  date: Date
  startTime: string
  durationMinutes: number
  instructorId: string
  substituteInstructorId: string | null
  isTrial: boolean
  isMakeup: boolean
  status: "scheduled" | "completed" | "cancelled"
  cancelReason: string | null
  topic: string | null
  homework: string | null
  rescheduledFromDate: Date | null
}

/**
 * Кладёт снимок удалённого занятия в архив. Вызывать ПОСЛЕ успешного
 * db.lesson.delete — иначе при отказе удаления (FK на заметки о ребёнке,
 * отработки) в архиве останется строка про живое занятие.
 *
 * packageSelections — результат snapshotPackageSelections, снятый ДО удаления:
 * строки SubscriptionLesson уходят по cascade, и без снимка вернуть пакетам их
 * выбор невозможно.
 */
export async function archiveDeletedLesson(
  db: DB,
  params: {
    tenantId: string
    lesson: ArchivableLesson
    packageSelections: DeletedSelectionSnapshot[]
    deletedBy: string | null
  },
): Promise<void> {
  const { tenantId, lesson, packageSelections, deletedBy } = params
  await db.deletedLesson.create({
    data: {
      tenantId,
      groupId: lesson.groupId,
      lessonId: lesson.id,
      date: lesson.date,
      startTime: lesson.startTime,
      durationMinutes: lesson.durationMinutes,
      instructorId: lesson.instructorId,
      substituteInstructorId: lesson.substituteInstructorId,
      isTrial: lesson.isTrial,
      isMakeup: lesson.isMakeup,
      status: lesson.status,
      cancelReason: lesson.cancelReason,
      topic: lesson.topic,
      homework: lesson.homework,
      rescheduledFromDate: lesson.rescheduledFromDate,
      packageSelections: packageSelections.length
        ? packageSelections.map((s) => ({ subscriptionId: s.subscriptionId }))
        : undefined,
      deletedBy,
    },
  })
}

export type RestoreResult =
  | { ok: true; lessonId: string; selectionsRestored: number }
  | { ok: false; status: number; error: string }

/**
 * Восстанавливает занятие из архивной строки.
 *
 * Гарантии:
 *  - строку восстанавливаем один раз (restoredAt проверяется и проставляется);
 *  - слот (группа + дата + время) должен быть свободен — иначе получим дубль
 *    занятия в сетке (то же занятие могли создать заново вручную или
 *    догенерацией);
 *  - выбор пакетов возвращаем только тем абонементам, что ещё живы и у которых
 *    осталось свободное место (totalLessons > выбрано) — иначе пакет ушёл бы в
 *    минус по количеству;
 *  - деньги календарных абонементов двигает тот же recalcSubscriptionsOnScheduleChange,
 *    что и удаление, только с addedDates — зеркально. Для отменённого занятия
 *    дельты нет (удаление её тоже не давало).
 */
export async function restoreDeletedLesson(
  db: PrismaClient,
  params: { tenantId: string; deletedLessonId: string; restoredBy: string | null },
): Promise<RestoreResult> {
  const { tenantId, deletedLessonId, restoredBy } = params

  const row = await db.deletedLesson.findFirst({
    where: { id: deletedLessonId, tenantId },
  })
  if (!row) return { ok: false, status: 404, error: "Запись об удалении не найдена" }
  if (row.restoredAt) {
    return { ok: false, status: 409, error: "Занятие уже восстановлено" }
  }

  const clash = await db.lesson.findFirst({
    where: {
      tenantId,
      groupId: row.groupId,
      date: row.date,
      startTime: row.startTime,
    },
    select: { id: true },
  })
  if (clash) {
    return {
      ok: false,
      status: 409,
      error: "В это время у группы уже есть занятие — восстанавливать нечего",
    }
  }

  // Пакеты, которым вернём выбор: живые, с незаполненным лимитом.
  const selections = Array.isArray(row.packageSelections)
    ? (row.packageSelections as Array<{ subscriptionId?: string }>)
        .map((s) => s?.subscriptionId)
        .filter((v): v is string => typeof v === "string")
    : []

  const created = await db.$transaction(async (tx) => {
    const lesson = await tx.lesson.create({
      data: {
        tenantId,
        groupId: row.groupId,
        date: row.date,
        startTime: row.startTime,
        durationMinutes: row.durationMinutes,
        instructorId: row.instructorId,
        substituteInstructorId: row.substituteInstructorId,
        isTrial: row.isTrial,
        isMakeup: row.isMakeup,
        status: row.status,
        cancelReason: row.cancelReason,
        topic: row.topic,
        homework: row.homework,
        rescheduledFromDate: row.rescheduledFromDate,
      },
      select: { id: true },
    })

    let selectionsRestored = 0
    for (const subscriptionId of selections) {
      const sub = await tx.subscription.findFirst({
        where: {
          id: subscriptionId,
          tenantId,
          deletedAt: null,
          type: "package",
          status: { in: ["active", "pending"] },
        },
        select: { id: true, totalLessons: true, _count: { select: { selectedLessons: true } } },
      })
      if (!sub) continue
      if (sub._count.selectedLessons >= sub.totalLessons) continue
      await tx.subscriptionLesson.create({
        data: { tenantId, subscriptionId: sub.id, lessonId: lesson.id },
      })
      selectionsRestored++

      // Задача «Перевыбрать занятие пакета», созданная при удалении, потеряла
      // смысл — место у пакета снова занято этим же занятием. Описание задачи
      // детерминировано (см. createReselectPackageLessonTasks), поэтому находим
      // её точным совпадением, а не по подстроке.
      const reselectDescription =
        `Занятие ${row.date.toLocaleDateString("ru-RU")} отменено — у пакета освободилось место. ` +
        `Выберите новое занятие в сроке действия пакета (карточка клиента → Абонементы). ` +
        `[sub:${sub.id}]`
      await tx.task.updateMany({
        where: {
          tenantId,
          autoTrigger: "reselect_package_lesson",
          status: "pending",
          deletedAt: null,
          description: reselectDescription,
        },
        data: { status: "cancelled" },
      })
    }

    await tx.deletedLesson.update({
      where: { id: row.id },
      data: { restoredAt: new Date(), restoredBy, restoredLessonId: lesson.id },
    })

    return { lessonId: lesson.id, selectionsRestored }
  })

  // Календарные абонементы получают занятие обратно (+1 занятие и долг на ту же
  // сумму) — зеркало removedDates при удалении. Пакетные не трогаются: у них
  // totalLessons купленное количество, не план.
  if (row.status !== "cancelled") {
    const { recalcSubscriptionsOnScheduleChange } = await import(
      "@/lib/subscriptions/recalc-on-schedule-change"
    )
    await recalcSubscriptionsOnScheduleChange(db, {
      tenantId,
      groupId: row.groupId,
      addedDates: [new Date(row.date)],
      removedDates: [],
      createdBy: restoredBy,
    })
  }

  return { ok: true, ...created }
}
