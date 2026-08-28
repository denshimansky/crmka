/**
 * Одноразовая корректировка данных (баг «дубль отметки при двух покрывающих
 * абонементах», 28.08.2026).
 *
 * Ключ отметки — (занятие, АБОНЕМЕНТ), поэтому когда резолвер списания сменил
 * абонемент (пакет A исчерпан ретро-отметками, пакет B выписан задним числом с
 * пересечением периода), повторная отметка на том же занятии не находила
 * прежнюю строку и создавала ВТОРУЮ: одно занятие списывалось с ДВУХ
 * абонементов. Первопричина исправлена в POST/PUT /api/lessons/[id]/attendance
 * (переиспользование строки того же ребёнка), здесь — разбор последствий.
 *
 * Кейс (msk1): Тарасова Марина, занятие 26.08.2026 «Говорилка 3+».
 *   пакет A c60269da: 6 занятий за 3750 ₽, но 7 списаний → final 4375, долг 625 ₽
 *   пакет B 44459237: 8 занятий за 5000 ₽, сгорело лишнее занятие
 *   инструктор: 180 ₽ начислено дважды за одного ребёнка на одном занятии
 *
 * Что делает скрипт: для каждой группы дублей (занятие, клиент, подопечный)
 * оставляет отметку на том абонементе, который НЕ уходит в перерасход
 * (израсходовано ≤ totalLessons), а лишнюю удаляет ТЕМ ЖЕ путём, что DELETE
 * /api/lessons/[id]/attendance:
 *   chargedAmount −= charge → откат lesson_refund (chargePercent<100) → delete →
 *   reallocateLessonPay(занятие) → repriceSubscription(обоих абонементов).
 * Плюс отдельный шаг: удаление финансово ПУСТЫХ заглушек (is_pending, charge=0,
 * ЗП=0), висящих рядом с реальной отметкой того же ребёнка — та же чистка, что
 * делает POST (orphanNullSub), но до неё в этих занятиях дело не дошло.
 *
 * Не трогаем: пробные (isTrial — сбрасываются через /api/trial-lessons/[id]) и
 * отработки (isMakeup — отдельный визит со своей семантикой), а также отметки на
 * отчислённых/закрытых абонементах (замок «отработанного абонемента»: деньги по
 * ним сведены при закрытии, откат списания их не вернёт — см. кейс Валеевой).
 * Idempotent: повторный прогон не находит дублей → no-op.
 *
 * Запуск (из app/), DATABASE_URL → прод через SSH-туннель:
 *   npx tsx scripts/fix-duplicate-attendance-two-subs.ts           # DRY-RUN (откат)
 *   npx tsx scripts/fix-duplicate-attendance-two-subs.ts --apply   # APPLY
 */
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { applyBalanceDelta } from "@/lib/balance/transactions"
import { calcRefund } from "@/lib/balance/calc-refund"
import { reallocateLessonPay } from "@/lib/salary/reallocate-lesson-pay"
import { repriceSubscription } from "@/lib/discounts/recalc-client-discounts"
import { consumedTypeWhereFor } from "@/lib/subscriptions/consumed-lessons"

const APPLY = process.argv.includes("--apply")

class DryRunRollback extends Error {}

type Row = {
  id: string
  tenantId: string
  lessonId: string
  clientId: string
  wardId: string | null
  subscriptionId: string | null
  chargeAmount: Prisma.Decimal
  instructorPayAmount: Prisma.Decimal
  isPending: boolean
  markedAt: Date | null
}

const money = (v: Prisma.Decimal | number) => new Prisma.Decimal(v).toFixed(2)

async function main() {
  console.log(`\nРежим: ${APPLY ? "APPLY" : "DRY-RUN"}\n`)

  // Группы дублей: один ребёнок — одно занятие — больше одной «обычной» отметки.
  // Пробные и отработки в дубли не считаем: это отдельные визиты.
  const dupGroups = await db.$queryRaw<
    { lesson_id: string; client_id: string; ward_id: string | null; cnt: bigint }[]
  >`
    SELECT lesson_id, client_id, ward_id, count(*) AS cnt
    FROM attendances
    WHERE is_trial = false AND is_makeup = false
    GROUP BY lesson_id, client_id, ward_id
    HAVING count(*) > 1
  `

  if (dupGroups.length === 0) {
    console.log("Дублей нет — данные уже в порядке.")
    return
  }
  console.log(`Групп дублей (занятие, клиент, подопечный): ${dupGroups.length}\n`)

  let fixedDup = 0
  let fixedPlaceholder = 0
  let skipped = 0

  for (const g of dupGroups) {
    const rows = (await db.attendance.findMany({
      where: {
        lessonId: g.lesson_id,
        clientId: g.client_id,
        wardId: g.ward_id,
        isTrial: false,
        isMakeup: false,
      },
      select: {
        id: true,
        tenantId: true,
        lessonId: true,
        clientId: true,
        wardId: true,
        subscriptionId: true,
        chargeAmount: true,
        instructorPayAmount: true,
        isPending: true,
        markedAt: true,
      },
      orderBy: { createdAt: "asc" },
    })) as Row[]

    const lesson = await db.lesson.findUnique({
      where: { id: g.lesson_id },
      select: { id: true, date: true, group: { select: { name: true, directionId: true } } },
    })
    const client = await db.client.findUnique({
      where: { id: g.client_id },
      select: { firstName: true, lastName: true },
    })
    const who = `${client?.lastName ?? ""} ${client?.firstName ?? ""}`.trim() || g.client_id
    const when = lesson?.date.toISOString().slice(0, 10) ?? "?"
    const head = `${who} | ${when} | ${lesson?.group.name ?? "?"}`

    // Шаг 1. Финансово пустые заглушки рядом с реальной отметкой — просто мусор
    // (та же чистка, что orphanNullSub в POST). Удаляем без денежных откатов.
    const real = rows.filter(
      (r) => !r.isPending || r.chargeAmount.gt(0) || r.instructorPayAmount.gt(0),
    )
    const emptyPlaceholders = rows.filter(
      (r) => r.isPending && r.chargeAmount.eq(0) && r.instructorPayAmount.eq(0),
    )
    if (real.length >= 1 && emptyPlaceholders.length > 0) {
      console.log(`  ${head}`)
      console.log(
        `    заглушки «Не отмечен» без денег: ${emptyPlaceholders.length} → удалить ` +
          `(остаётся реальных отметок: ${real.length})`,
      )
      if (APPLY) {
        await db.attendance.deleteMany({ where: { id: { in: emptyPlaceholders.map((r) => r.id) } } })
      }
      fixedPlaceholder += emptyPlaceholders.length
      if (real.length < 2) continue
    }

    // Шаг 2. Настоящий дубль «две отметки на двух абонементах».
    const withSub = real.filter((r) => r.subscriptionId)
    if (real.length < 2 || withSub.length < 2) {
      console.log(`  ${head}\n    ПРОПУСК: не кейс «два абонемента» (разбирать вручную)`)
      skipped++
      continue
    }

    // Кого оставляем: абонемент, который НЕ в перерасходе. «Израсходовано»
    // считаем ровно как денежный пересчёт (consumedTypeWhereFor).
    const stats = new Map<string, { total: number; consumed: number; status: string; type: string }>()
    for (const r of withSub) {
      const sid = r.subscriptionId!
      if (stats.has(sid)) continue
      const sub = await db.subscription.findUnique({
        where: { id: sid },
        select: { totalLessons: true, status: true, type: true, tenantId: true },
      })
      if (!sub) continue
      const consumed = await db.attendance.count({
        where: { tenantId: sub.tenantId, subscriptionId: sid, attendanceType: consumedTypeWhereFor(sub.type) },
      })
      stats.set(sid, { total: sub.totalLessons, consumed, status: sub.status, type: sub.type })
    }

    console.log(`  ${head}`)
    for (const r of withSub) {
      const st = stats.get(r.subscriptionId!)
      console.log(
        `    отметка ${r.id.slice(0, 8)} | абонемент ${r.subscriptionId!.slice(0, 8)} ` +
          `(${st?.type}/${st?.status}, израсходовано ${st?.consumed}/${st?.total}) | ` +
          `списано ${money(r.chargeAmount)} | ЗП ${money(r.instructorPayAmount)} | ` +
          `отмечено ${r.markedAt?.toISOString() ?? "—"}`,
      )
    }

    // Замок отработанного абонемента: если хоть один из абонементов отчислён/
    // закрыт — деньги по нему уже сведены, автоматом не трогаем.
    const locked = [...stats.values()].some((s) => s.status === "withdrawn" || s.status === "closed")
    if (locked) {
      console.log("    ПРОПУСК: среди абонементов есть отчислённый/закрытый (замок) — вручную")
      skipped++
      continue
    }

    const overrun = withSub.filter((r) => {
      const st = stats.get(r.subscriptionId!)
      return st ? st.consumed > st.total : false
    })
    if (overrun.length !== 1 || withSub.length !== 2) {
      console.log(
        "    ПРОПУСК: однозначно лишнюю отметку не определить " +
          `(в перерасходе: ${overrun.length} из ${withSub.length}) — вручную`,
      )
      skipped++
      continue
    }

    const drop = overrun[0]
    const keep = withSub.find((r) => r.id !== drop.id)!
    console.log(
      `    → удаляем ${drop.id.slice(0, 8)} (абонемент в перерасходе), ` +
        `оставляем ${keep.id.slice(0, 8)}`,
    )

    const dropSubId = drop.subscriptionId!
    const keepSubId = keep.subscriptionId!
    const chargePercent = (
      await db.attendance.findUnique({
        where: { id: drop.id },
        select: { attendanceType: { select: { chargePercent: true } } },
      })
    )?.attendanceType.chargePercent

    // Состояние абонементов ПОСЛЕ пересчёта снимаем внутри транзакции: в
    // DRY-RUN она откатывается, и снаружи было бы видно старое значение.
    let after: string[] = []

    try {
      await db.$transaction(
        async (tx) => {
          // 1. Откат списания с абонемента (как в DELETE).
          if (drop.chargeAmount.gt(0)) {
            await tx.subscription.update({
              where: { id: dropSubId },
              data: { chargedAmount: { decrement: drop.chargeAmount } },
            })
            // 2. Откат частичного возврата на баланс (chargePercent < 100).
            const refund = calcRefund(drop.chargeAmount, chargePercent ?? 100)
            if (refund.gt(0)) {
              await applyBalanceDelta(tx, {
                tenantId: drop.tenantId,
                clientId: drop.clientId,
                delta: refund.negated(),
                type: "attendance_revert",
                refs: {
                  lessonId: drop.lessonId,
                  attendanceId: drop.id,
                  directionId: lesson!.group.directionId,
                  subscriptionId: dropSubId,
                },
                createdBy: null,
              })
            }
          }

          // 3. Удаляем лишнюю строку.
          await tx.attendance.delete({ where: { id: drop.id } })

          // 4. ЗП занятия: раскладка per_lesson/floating зависит от состава.
          await reallocateLessonPay(tx, { tenantId: drop.tenantId, lessonId: drop.lessonId })

          // 5. Деньги обоих абонементов — строго ПОСЛЕ удаления.
          await repriceSubscription(tx, {
            tenantId: drop.tenantId,
            subscriptionId: dropSubId,
            createdBy: null,
          })
          if (keepSubId !== dropSubId) {
            await repriceSubscription(tx, {
              tenantId: drop.tenantId,
              subscriptionId: keepSubId,
              createdBy: null,
            })
          }

          for (const sid of new Set([dropSubId, keepSubId])) {
            const s = await tx.subscription.findUnique({
              where: { id: sid },
              select: {
                totalLessons: true,
                totalAmount: true,
                finalAmount: true,
                chargedAmount: true,
                balance: true,
              },
            })
            if (s) {
              after.push(
                `    после — абонемент ${sid.slice(0, 8)}: занятий ${s.totalLessons}, ` +
                  `total ${money(s.totalAmount)}, final ${money(s.finalAmount)}, ` +
                  `charged ${money(s.chargedAmount)}, долг ${money(s.balance)}`,
              )
            }
          }
          const payLeft = await tx.attendance.aggregate({
            where: { lessonId: drop.lessonId },
            _sum: { instructorPayAmount: true },
          })
          after.push(`    после — ЗП по занятию всего: ${money(payLeft._sum.instructorPayAmount ?? 0)}`)

          if (!APPLY) throw new DryRunRollback()
        },
        { maxWait: 20_000, timeout: 60_000 },
      )
      fixedDup++
    } catch (e) {
      if (e instanceof DryRunRollback) {
        fixedDup++
      } else {
        console.error(`    ОШИБКА: ${(e as Error).message}`)
        skipped++
        after = []
      }
    }

    for (const line of after) console.log(line)
    console.log("")
  }

  console.log(
    `\nИтог (${APPLY ? "APPLY" : "DRY-RUN"}): дублей разобрано ${fixedDup}, ` +
      `пустых заглушек удалено ${fixedPlaceholder}, пропущено ${skipped}`,
  )
  if (!APPLY) console.log("DRY-RUN: изменения откатаны. Запуск с --apply — применить.")
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
