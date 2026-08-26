// Реконсиляция одного дня расписания при изменении производственного календаря
// или массовой отмене дня.
//
// Правило заказчика (23.07.2026): пометка дня нерабочим (или «Отменить день»)
// ПОСЛЕ создания расписания должна УДАЛИТЬ занятия этого дня и пересчитать
// абонементы — вернуть переплату на баланс клиента или повесить долг; возврат
// дня в рабочие — воссоздать занятия и снова пересчитать. Фактическое состояние
// абонементов/балансов/отчётов приводится в соответствие новому расписанию.
//
// Деньги НЕ трогаем напрямую: удаление/добавление занятий прогоняется через
// recalcSubscriptionsOnScheduleChange → repriceSubscription/recalcClientDiscounts,
// которые сами возвращают переплату на кошелёк (applyBalanceDelta, discount_refund)
// и покрывают долг активного абонемента из баланса. То же, что делает одиночное
// удаление занятия (api/lessons/[id] DELETE) — здесь лишь массово по дню.
//
// НЕтранзакционно (как generate/DELETE): generateGroupLessons
// использует глобальный db и читает календарь отдельным запросом, поэтому вызов
// на «рабочий день» обязан идти ПОСЛЕ коммита апсёрта календаря (иначе генератор
// не увидит, что день снова рабочий).

import { Prisma, type PrismaClient } from "@prisma/client"
import { generateGroupLessons } from "@/lib/schedule/generate-group-lessons"
import { recalcSubscriptionsOnScheduleChange } from "@/lib/subscriptions/recalc-on-schedule-change"
import {
  snapshotPackageSelections,
  createReselectPackageLessonTasks,
} from "@/lib/tasks/reselect-package-lesson"

type Tx = Prisma.TransactionClient | PrismaClient

/** Границы дня [полночь UTC, следующая полночь UTC) — под @db.Date. */
function dayBounds(date: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1))
  return { from, to }
}

export interface DeletableLessonRow {
  id: string
  date: Date
  groupId: string
  _count: { attendances: number; trialLessons: number }
}

/**
 * Чистое ядро: из занятий дня отбирает те, что можно удалить (нет реальных
 * отметок и активных пробных — тот же guard, что в одиночном DELETE занятия),
 * и группирует их даты по groupId для дельта-пересчёта абонементов.
 */
export function partitionDeletableLessons(lessons: DeletableLessonRow[]): {
  deletableIds: string[]
  removedDatesByGroup: Map<string, Date[]>
} {
  const deletableIds: string[] = []
  const removedDatesByGroup = new Map<string, Date[]>()
  for (const l of lessons) {
    // Занятия с проведёнными отметками / активными пробными не трогаем: прошлое
    // не откатываем, ЗП инструктора и посещения сохраняются.
    if (l._count.attendances > 0 || l._count.trialLessons > 0) continue
    deletableIds.push(l.id)
    const arr = removedDatesByGroup.get(l.groupId) ?? []
    arr.push(l.date)
    removedDatesByGroup.set(l.groupId, arr)
  }
  return { deletableIds, removedDatesByGroup }
}

/**
 * Что мешает объявить день нерабочим. Пометка «нерабочий» удаляет занятия дня, но
 * занятия с реальными отметками и активными пробными она НЕ трогает (см.
 * partitionDeletableLessons) — раньше день просто применялся наполовину: часть
 * занятий исчезала, отмеченные оставались, а запись календаря писалась. Позже, при
 * возврате дня в рабочие, генератор докладывал в расписание всё, чего «не хватает по
 * шаблону», и рядом с уцелевшим занятием появлялся дубль (кейс «Математика/Гурина»,
 * Школа студия Class, 03.08.2026 — двойные отметки и двойная ЗП).
 *
 * Поэтому пометка нерабочим теперь запрещается целиком, пока в дне есть отметки:
 * либо день действительно нерабочий и отметок в нём быть не может, либо занятия
 * состоялись и день рабочий. Промежуточного состояния нет.
 */
export async function findNonWorkingBlockers(
  db: Tx,
  params: { tenantId: string; date: Date; branchId?: string | null },
): Promise<{ markedLessons: number; trialLessons: number; details: string[] }> {
  const { tenantId, date, branchId } = params
  const { from, to } = dayBounds(date)

  const lessons = await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: from, lt: to },
      status: { not: "cancelled" },
      ...(branchId ? { group: { branchId } } : {}),
    },
    select: {
      startTime: true,
      group: { select: { name: true } },
      _count: {
        select: {
          attendances: { where: { isPending: false } },
          trialLessons: { where: { status: { not: "cancelled" } } },
        },
      },
    },
    orderBy: { startTime: "asc" },
  })

  let markedLessons = 0
  let trialLessons = 0
  const details: string[] = []
  for (const l of lessons) {
    if (l._count.attendances === 0 && l._count.trialLessons === 0) continue
    if (l._count.attendances > 0) markedLessons++
    if (l._count.trialLessons > 0) trialLessons++
    const parts: string[] = []
    if (l._count.attendances > 0) parts.push(`отметок: ${l._count.attendances}`)
    if (l._count.trialLessons > 0) parts.push(`пробных: ${l._count.trialLessons}`)
    details.push(`${l.startTime} · ${l.group.name} (${parts.join(", ")})`)
  }
  return { markedLessons, trialLessons, details }
}

/** Текст отказа для UI. null — препятствий нет. */
export function nonWorkingBlockReason(b: {
  markedLessons: number
  trialLessons: number
}): string | null {
  if (b.markedLessons > 0) {
    return "В этот день уже есть отмеченные занятия. Снимите все отметки, а потом сможете поставить нерабочий день."
  }
  if (b.trialLessons > 0) {
    return "В этот день есть занятия с активными пробными. Отмените или перенесите пробные, а потом сможете поставить нерабочий день."
  }
  return null
}

/**
 * День становится нерабочим (или его отменяют): удалить занятия дня без реальных
 * отметок и пересчитать абонементы затронутых групп. branchId — ограничить одним
 * филиалом (частичная отмена дня). Возвращает число удалённых занятий и
 * пересчитанных абонементов.
 */
export async function reconcileDayToNonWorking(
  db: Tx,
  params: { tenantId: string; date: Date; branchId?: string | null; createdBy?: string | null },
): Promise<{ deleted: number; subscriptionsUpdated: number }> {
  const { tenantId, date, branchId, createdBy } = params
  const { from, to } = dayBounds(date)

  const lessons = (await db.lesson.findMany({
    where: {
      tenantId,
      date: { gte: from, lt: to },
      status: { not: "cancelled" },
      ...(branchId ? { group: { branchId } } : {}),
    },
    select: {
      id: true,
      date: true,
      groupId: true,
      _count: {
        select: {
          attendances: { where: { isPending: false } },
          trialLessons: { where: { status: { not: "cancelled" } } },
        },
      },
    },
  })) as DeletableLessonRow[]

  const { deletableIds, removedDatesByGroup } = partitionDeletableLessons(lessons)
  if (deletableIds.length === 0) return { deleted: 0, subscriptionsUpdated: 0 }

  // Пакет с выбором: снимок выборов ДО удаления (cascade сотрёт строки) — задачи
  // на перевыбор создаём после (решение владельца №2). Для не-package пусто.
  const selSnapshot = await snapshotPackageSelections(db, tenantId, deletableIds)

  // FK перед удалением: отвязать отменённые пробные и снять placeholder-отметки
  // (isPending) — как в одиночном DELETE занятия.
  await db.trialLesson.updateMany({
    where: { lessonId: { in: deletableIds }, status: "cancelled" },
    data: { lessonId: null },
  })
  await db.attendance.deleteMany({
    where: { lessonId: { in: deletableIds }, tenantId, isPending: true },
  })
  await db.lesson.deleteMany({ where: { id: { in: deletableIds } } })

  let subscriptionsUpdated = 0
  for (const [groupId, removedDates] of removedDatesByGroup) {
    const r = await recalcSubscriptionsOnScheduleChange(db, {
      tenantId,
      groupId,
      addedDates: [],
      removedDates,
      createdBy: createdBy ?? null,
    })
    subscriptionsUpdated += r.updated
  }

  await createReselectPackageLessonTasks(db, tenantId, selSnapshot, createdBy ?? null)

  return { deleted: deletableIds.length, subscriptionsUpdated }
}

/**
 * День возвращается в рабочие: догенерировать занятия дня по шаблонам живых групп
 * и пересчитать абонементы. Вызывать ПОСЛЕ апсёрта календаря (isWorking=true /
 * удаления записи) — generateGroupLessons читает календарь и пропустил бы день,
 * пока он ещё числится нерабочим. Дубликаты генератор отсеивает сам.
 */
export async function reconcileDayToWorking(
  db: Tx,
  params: { tenantId: string; date: Date; createdBy?: string | null },
): Promise<{ created: number; subscriptionsUpdated: number }> {
  const { tenantId, date, createdBy } = params
  const { from } = dayBounds(date)

  const groups = await db.group.findMany({
    where: { tenantId, deletedAt: null },
    select: {
      id: true,
      instructorId: true,
      templates: {
        where: { effectiveTo: null },
        select: { dayOfWeek: true, startTime: true, durationMinutes: true },
      },
    },
  })

  let created = 0
  let subscriptionsUpdated = 0
  for (const g of groups) {
    if (g.templates.length === 0) continue
    const gen = await generateGroupLessons({
      tenantId,
      groupId: g.id,
      instructorId: g.instructorId,
      templates: g.templates,
      rangeStart: from,
      rangeEnd: from,
      createdBy: createdBy ?? null,
      // Пересчёт делаем сами дельтой по созданным датам — единообразно с delete-веткой.
      skipSubscriptionRecalc: true,
    })
    if (gen.created > 0) {
      created += gen.created
      const r = await recalcSubscriptionsOnScheduleChange(db, {
        tenantId,
        groupId: g.id,
        addedDates: gen.createdDates,
        removedDates: [],
        createdBy: createdBy ?? null,
      })
      subscriptionsUpdated += r.updated
    }
  }
  return { created, subscriptionsUpdated }
}
