/**
 * Одноразовый ремонт: групповые пробные, потерявшие занятие (03.09.2026).
 *
 * Как ломалось. Групповое пробное — строка trial_lessons с group_id и ссылкой
 * lesson_id на занятие группы; своего Attendance до отметки у него нет, а FK
 * trial_lessons.lesson_id стоит ON DELETE SET NULL. Перегенерация расписания
 * группы (regenerateGroupSchedule при смене шаблонов и regenerateOnDateChange
 * при сохранении дат группы — её дёргает кнопка «Перегенерировать») удаляла
 * будущие занятия «не по шаблону», проверяя только отсутствие отметок. Занятие
 * с записанным пробным удалялось, FK молча обнулял lesson_id — и пробное
 * оставалось сиротой: status=scheduled, но без времени, без ссылки на карточку
 * занятия, и ребёнка нет в составе занятия (состав ищет пробные по lesson_id).
 * Ни deleted_lessons, ни audit_log перегенерация не пишет, поэтому следов нет.
 *
 * Кейс (msk1): «ДЦ Умный Я», группа «4кл ВТ/ЧТ 17.00», 05.09.2026 —
 * Болотнова Арина и Корнюшина София. Занятие 03.09 17:00 перенесли на 05.09
 * 09:00, в него записали два пробных, а 01.09 перегенерация снесла субботнее
 * занятие (у группы шаблон ВТ/ЧТ) и создала новое на 03.09. Плюс «Детский
 * центр Dream», 03.09.2026 — Кратюк Михаил.
 *
 * Первопричина исправлена в lib/schedule/generate-group-lessons.ts
 * (partitionRegenLessons: отметки, активные пробные и ручные переносы занятие
 * защищают), здесь — разбор последствий.
 *
 * Что делает скрипт: для каждого осиротевшего АКТИВНОГО пробного (scheduled /
 * attended / no_show) с group_id и lesson_id = NULL ищет живое занятие той же
 * группы на ту же дату (scheduled_date) и перепривязывает пробное к нему.
 * Отменённые пробные (status=cancelled) не трогает — их отвязывают намеренно
 * (см. DELETE /api/lessons/[id] и reconcileDayToNonWorking).
 *
 * Перед привязкой повторяет инварианты createTrialLessonForClient, чтобы
 * ребёнок не задвоился в составе занятия:
 *   • на этом занятии нет другого активного пробного того же подопечного;
 *   • на этом занятии нет его не-пробной реальной отметки (isPending=false);
 *   • у подопечного нет активного зачисления/абонемента в этой группе.
 * Не подошедшие случаи (нет занятия на дату, несколько занятий, инвариант) —
 * печатает списком: их разбирает администратор через UI («Перенести» пробное).
 *
 * Внимание: время у восстановленного пробного берётся от найденного занятия и
 * может отличаться от того, на которое записывали родителя (занятие, о котором
 * договаривались, удалено безвозвратно). Список привязок ниже — с временем,
 * чтобы администратор мог сверить и при необходимости перенести пробное.
 *
 * Idempotent: повторный прогон сирот не находит → no-op.
 *
 * Запуск (из app/), DATABASE_URL → прод через SSH-туннель:
 *   npx tsx scripts/fix-orphan-trial-lessons.ts           # DRY-RUN (откат)
 *   npx tsx scripts/fix-orphan-trial-lessons.ts --apply    # APPLY
 */
import { db } from "@/lib/db"

const APPLY = process.argv.includes("--apply")

class DryRunRollback extends Error {}

const ACTIVE_TRIAL = ["scheduled", "attended", "no_show"] as const

function fio(p: { firstName: string | null; lastName: string | null }): string {
  return [p.lastName, p.firstName].filter(Boolean).join(" ") || "Без имени"
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function main() {
  const orphans = await db.trialLesson.findMany({
    where: {
      groupId: { not: null },
      lessonId: null,
      status: { in: [...ACTIVE_TRIAL] },
    },
    select: {
      id: true,
      tenantId: true,
      clientId: true,
      wardId: true,
      groupId: true,
      scheduledDate: true,
      status: true,
      createdAt: true,
      organization: { select: { name: true } },
      client: { select: { firstName: true, lastName: true } },
      ward: { select: { id: true, firstName: true, lastName: true } },
      group: { select: { name: true } },
    },
    orderBy: [{ tenantId: "asc" }, { scheduledDate: "asc" }],
  })

  console.log(
    `Осиротевших активных пробных: ${orphans.length} (${APPLY ? "APPLY" : "DRY-RUN"})\n`,
  )
  if (orphans.length === 0) return

  let relinked = 0
  const manual: string[] = []

  for (const t of orphans) {
    const who = `${t.organization.name} · ${fio(t.client)} / ${t.ward ? fio(t.ward) : "—"} · ${ymd(t.scheduledDate)} · ${t.group?.name ?? "—"}`

    // Живые занятия группы на дату пробного. Отменённые не берём: пробное на
    // отменённом занятии — не восстановление, а новая проблема.
    const candidates = await db.lesson.findMany({
      where: {
        tenantId: t.tenantId,
        groupId: t.groupId!,
        date: t.scheduledDate,
        status: { not: "cancelled" },
      },
      select: { id: true, startTime: true, durationMinutes: true },
      orderBy: { startTime: "asc" },
    })

    if (candidates.length === 0) {
      manual.push(`${who} → занятия группы на эту дату нет (записать пробное заново)`)
      continue
    }
    if (candidates.length > 1) {
      manual.push(
        `${who} → занятий на дату несколько (${candidates.map((c) => c.startTime).join(", ")}) — выбрать вручную`,
      )
      continue
    }
    const lesson = candidates[0]

    // Инварианты createTrialLessonForClient: ребёнок не должен попасть в состав
    // занятия дважды.
    const [dupTrial, realAttendance, enrollment, subscription] = await Promise.all([
      db.trialLesson.findFirst({
        where: {
          tenantId: t.tenantId,
          lessonId: lesson.id,
          wardId: t.wardId,
          status: { in: [...ACTIVE_TRIAL] },
          id: { not: t.id },
        },
        select: { id: true },
      }),
      db.attendance.findFirst({
        where: {
          tenantId: t.tenantId,
          lessonId: lesson.id,
          wardId: t.wardId,
          isTrial: false,
          isPending: false,
        },
        select: { id: true },
      }),
      db.groupEnrollment.findFirst({
        where: {
          tenantId: t.tenantId,
          wardId: t.wardId,
          groupId: t.groupId!,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      }),
      db.subscription.findFirst({
        where: {
          tenantId: t.tenantId,
          wardId: t.wardId,
          groupId: t.groupId!,
          status: { in: ["active", "pending"] },
          deletedAt: null,
        },
        select: { id: true },
      }),
    ])

    if (dupTrial) {
      manual.push(`${who} → на занятии уже есть активное пробное этого ребёнка`)
      continue
    }
    if (realAttendance) {
      manual.push(`${who} → ребёнок уже отмечен на этом занятии как ученик`)
      continue
    }
    if (enrollment || subscription) {
      manual.push(
        `${who} → у ребёнка уже есть ${enrollment ? "место в группе" : "абонемент"} — пробное не нужно`,
      )
      continue
    }

    try {
      await db.$transaction(async (tx) => {
        await tx.trialLesson.update({
          where: { id: t.id },
          data: { lessonId: lesson.id },
        })
        if (!APPLY) throw new DryRunRollback()
      })
      relinked++
      console.log(`  ✓ ${who} → занятие ${lesson.startTime} (${lesson.id})`)
    } catch (e) {
      if (e instanceof DryRunRollback) {
        relinked++
        console.log(`  ✓ ${who} → занятие ${lesson.startTime} (${lesson.id})`)
      } else {
        console.error(`  ОШИБКА ${who}: ${(e as Error).message}`)
      }
    }
  }

  if (manual.length > 0) {
    console.log(`\nТребуют ручного разбора (${manual.length}):`)
    for (const line of manual) console.log(`  • ${line}`)
  }

  console.log(
    `\nИтог (${APPLY ? "APPLY" : "DRY-RUN"}): перепривязано ${relinked}, вручную ${manual.length}`,
  )
  if (!APPLY) console.log("DRY-RUN: изменения откатаны. Запуск с --apply — применить.")
  console.log(
    "Проверить время: у восстановленных пробных время теперь от найденного занятия — " +
      "если родителя записывали на другое, перенести пробное через UI.",
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
