import { db as defaultDb } from "@/lib/db"
import type { Prisma, PrismaClient } from "@prisma/client"

type Db = Prisma.TransactionClient | PrismaClient

export interface CountLessonsInput {
  tenantId: string
  groupId: string
  rangeStart: Date // inclusive
  rangeEnd: Date // inclusive
}

export interface CountLessonsResult {
  count: number
  hasSchedule: boolean
}

/**
 * Количество занятий группы за период — по ФАКТИЧЕСКИМ занятиям (Lesson),
 * не по проекции шаблона. Используется массовой выпиской абонементов на месяц
 * (bulk-renew) для числа занятий и суммы.
 *
 * Реальные Lesson-строки — единственный источник правды: они уже учитывают
 * производственный календарь (нерабочие дни пропускаются при генерации и
 * удаляются реконсиляцией дня), границы жизни группы (start/end_date) и любые
 * ручные правки расписания. Ручная форма создания абонемента и реконсиляция
 * дня давно считают именно по Lesson — здесь приводим массовую выписку к тому
 * же источнику.
 *
 * Раньше здесь была проекция GroupScheduleTemplate на диапазон (итерация по
 * дням + вычет нерабочих). Она расходилась с фактом и завышала выписку —
 * первопричина бага календаря 29.07.2026:
 *   - «9 вместо 8»: проекция Пн+Ср считала понедельник 31.08, которого в
 *     расписании нет (последнее занятие 26.08). Выходные 28–31.08 внесли в
 *     календарь ПОСЛЕ выписки, а реконсиляция задним числом ничего не сняла —
 *     Lesson-строки на 31.08 не существовало.
 *   - «21 вместо 0»: «Летний клуб» закончился 31.07 (end_date), но шаблон
 *     Пн–Пт (effectiveTo=null) проецировался на весь август → 21 фантомное
 *     занятие в группе, которой в августе нет.
 *
 * hasSchedule = у группы есть активный шаблон расписания в диапазоне. Отделяет
 * «расписания нет вовсе» от «расписание есть, но занятий в периоде нет» (группа
 * завершилась / всё нерабочее): обе дают count 0, но bulk-renew показывает для
 * второй причину «нет занятий», а не «нет расписания».
 */
export async function countLessonsForGroup(
  opts: CountLessonsInput,
  client: Db = defaultDb,
): Promise<CountLessonsResult> {
  const { tenantId, groupId, rangeStart, rangeEnd } = opts

  const from = new Date(rangeStart)
  from.setHours(0, 0, 0, 0)
  const to = new Date(rangeEnd)
  to.setHours(23, 59, 59, 999)

  const [templateCount, count] = await Promise.all([
    client.groupScheduleTemplate.count({
      where: {
        tenantId,
        groupId,
        effectiveFrom: { lte: to },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
      },
    }),
    client.lesson.count({
      where: {
        tenantId,
        groupId,
        status: { not: "cancelled" },
        date: { gte: from, lte: to },
      },
    }),
  ])

  return { count, hasSchedule: templateCount > 0 }
}
