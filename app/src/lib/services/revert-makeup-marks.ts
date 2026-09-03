import type { Prisma } from "@prisma/client"

/** Только внутри транзакции переноса занятия. */
type Tx = Prisma.TransactionClient

export interface DetachedMakeup {
  clientId: string
  childDisplayName: string
  /** Исходное (пропущенное) занятие — по нему админ поймёт, что переназначать. */
  sourceLessonDate: Date
  sourceDirectionName: string
}

/**
 * Перенос занятия снимает назначенные на него отработки.
 *
 * Модель отработки двусторонняя: на исходном занятии L1 у ребёнка отметка
 * «Назначена отработка» (makeup_scheduled) или «Отработано» (makeup) со ссылкой
 * scheduledMakeupLessonId → целевое занятие L2, а на самом L2 ребёнок приходит
 * виртуальной строкой и после отметки получает Attendance с isMakeup=true.
 *
 * Перенос L2 удалял отметку с isMakeup вместе со всеми прочими (политика «перенос
 * сбрасывает отметки»), но сторону L1 не трогал: у ребёнка на исходном занятии
 * оставалось «Отработано»/«Назначена отработка» со ссылкой на занятие, которое
 * уехало на другую дату, — и ни ученик, ни админ об этом не узнавали.
 *
 * Решение владельца (03.09.2026): отработку с исходного занятия снимать
 * («Не был») и ставить админу задачу переназначить. Возвращаем данные для
 * задач — их создаёт вызывающий код после коммита, как при отмене занятия.
 */
export async function detachMakeupsFromLesson(
  tx: Tx,
  params: { tenantId: string; lessonId: string },
): Promise<DetachedMakeup[]> {
  const { tenantId, lessonId } = params

  const rows = await tx.attendance.findMany({
    where: {
      tenantId,
      scheduledMakeupLessonId: lessonId,
      attendanceType: { code: { in: ["makeup_scheduled", "makeup"] } },
    },
    select: {
      id: true,
      clientId: true,
      wardId: true,
      client: { select: { firstName: true, lastName: true } },
      lesson: {
        select: {
          date: true,
          group: { select: { direction: { select: { name: true } } } },
        },
      },
    },
  })
  if (rows.length === 0) return []

  // «Не был» — тот же тип, в который откатывает исходное занятие отметка
  // «Не был на отработке» (POST /api/lessons/[id]/attendance).
  const noShow = await tx.attendanceType.findFirst({
    where: { OR: [{ tenantId: null }, { tenantId }], code: "no_show", isActive: true },
    select: { id: true },
  })
  if (!noShow) return []

  // Ward у Attendance без relation — имена подтягиваем отдельно.
  const wardIds = [...new Set(rows.map((r) => r.wardId).filter((x): x is string => !!x))]
  const wards = wardIds.length
    ? await tx.ward.findMany({
        where: { id: { in: wardIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : []

  const out: DetachedMakeup[] = []
  for (const r of rows) {
    await tx.attendance.update({
      where: { id: r.id },
      data: { attendanceTypeId: noShow.id, scheduledMakeupLessonId: null },
    })
    const ward = r.wardId ? wards.find((w) => w.id === r.wardId) : null
    const wardName = ward ? [ward.lastName, ward.firstName].filter(Boolean).join(" ") : ""
    const clientName = [r.client.lastName, r.client.firstName].filter(Boolean).join(" ")
    out.push({
      clientId: r.clientId,
      childDisplayName: wardName || clientName || "Без имени",
      sourceLessonDate: r.lesson.date,
      sourceDirectionName: r.lesson.group.direction.name,
    })
  }
  return out
}
