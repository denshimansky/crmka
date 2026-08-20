import type { Prisma, PrismaClient } from "@prisma/client"

type Tx = Prisma.TransactionClient | PrismaClient

export interface TrialHolderLessonInput {
  tenantId: string
  directionId: string
  branchId: string
  roomId: string
  instructorId: string
  /** Дата пробного — полночь UTC, как Lesson.date / TrialLesson.scheduledDate (@db.Date). */
  date: Date
  startTime: string
  durationMinutes: number
  /** Имя ребёнка (или лида) — попадает в название скрытой группы и видно в карточке занятия. */
  label: string
}

/**
 * Техническое занятие под ИНДИВИДУАЛЬНОЕ пробное (пробное без группы).
 *
 * Зачем: ЗП инструктора в системе живёт исключительно в
 * `Attendance.instructorPayAmount` у `Lesson` — все страницы и отчёты по ЗП,
 * а также ОПИУ считают только его. У пробного без группы занятия не было, и
 * педагогу за проведённое бесплатное пробное начислить было нечем (флаг
 * «оплата инструктору» на самом пробном оставался мёртвым). Поэтому под такое
 * пробное заводится скрытая `Group(isOneTime, isTrialHolder)` с единственным
 * занятием — ровно тот же приём, что у разового занятия
 * (POST /api/standalone-lessons), только группа помечена как держатель пробного
 * и не показывается в сетке расписания (пробное рисуется своей карточкой).
 *
 * Дальше всё работает существующей механикой без единой правки в расчётах:
 * отметка «Был» создаёт `Attendance(isTrial, chargeAmount=0)` — клиенту
 * бесплатно, а `instructorPayAmount` считается через resolveRate/calcPay по
 * личной ставке инструктора с учётом режима «Оплата за пробное занятие».
 *
 * `TrialLesson.groupId` при этом остаётся NULL: с точки зрения воронки и
 * отчётов пробное по-прежнему «без группы», связь только через `lessonId`.
 *
 * `Lesson.isTrial = true` — занятие целиком пробное (в отличие от группового
 * пробного, которое едет пассажиром в обычном занятии). Это же снимает его с
 * перераспределения ЗП (reallocateLessonPay пропускает пробные занятия).
 */
export async function createTrialHolderLesson(
  tx: Tx,
  input: TrialHolderLessonInput,
): Promise<{ lessonId: string; groupId: string }> {
  const group = await tx.group.create({
    data: {
      tenantId: input.tenantId,
      // Имя видно только в карточке занятия и в детализации ЗП инструктора —
      // из реестра групп и отчётов по группам держатель исключён (isOneTime).
      name: `Пробное — ${input.label}`.slice(0, 120),
      directionId: input.directionId,
      branchId: input.branchId,
      roomId: input.roomId,
      instructorId: input.instructorId,
      maxStudents: 1,
      isActive: true,
      isOneTime: true,
      isTrialHolder: true,
    },
    select: { id: true },
  })

  const lesson = await tx.lesson.create({
    data: {
      tenantId: input.tenantId,
      groupId: group.id,
      date: input.date,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      instructorId: input.instructorId,
      isTrial: true,
      status: "scheduled",
    },
    select: { id: true },
  })

  return { lessonId: lesson.id, groupId: group.id }
}

/**
 * Синхронизирует статус занятия-держателя со статусом самого пробного:
 * отмена пробного гасит занятие (иначе оно продолжает занимать кабинет в
 * findRoomOccupant), возврат в работу — поднимает обратно.
 *
 * Фильтр по `group.isTrialHolder` — страховка: занятие настоящей группы
 * (групповое пробное) этой функцией не тронуть.
 */
export async function setTrialHolderLessonStatus(
  tx: Tx,
  tenantId: string,
  lessonId: string,
  status: "scheduled" | "cancelled",
): Promise<void> {
  await tx.lesson.updateMany({
    where: { id: lessonId, tenantId, group: { isTrialHolder: true } },
    data: { status },
  })
}
