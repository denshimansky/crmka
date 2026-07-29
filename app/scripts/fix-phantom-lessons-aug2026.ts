/**
 * Одноразовая корректировка данных (баг календаря 29.07.2026).
 *
 * Массовая выписка на август 2026 (тенант «Школа студия Class», 3a3d76c6)
 * завышала total_lessons: считала по ПРОЕКЦИИ шаблона расписания, а не по факту
 * (см. count-lessons.ts — там первопричина уже исправлена). Из-за этого живые
 * абонементы получили лишние занятия и завышенную сумму: «9 вместо 8» (Пн/Ср —
 * несуществующий понедельник 31.08) и «21 вместо 0» (Летний клуб закончился
 * 31.07, но шаблон Пн–Пт спроецировался на август).
 *
 * Приводим живые (pending) абонементы к ФАКТИЧЕСКОМУ числу занятий тем же
 * сервисным путём, что PATCH абонемента и пересчёт при изменении расписания:
 *   total_lessons + total_amount → recalcClientDiscounts (инвариант тип 1/2:
 *   мог смениться «самый дорогой» месяца) → repriceSubscription (final/balance).
 *
 * Только pending: у затронутых attended=0, paid=0, charged=0 (август — будущее),
 * поэтому движения денег/возвратов нет — только уменьшение сумм. withdrawn/closed
 * не трогаем: repriceSubscription их и так пропускает (история расчётов закрыта).
 * Idempotent: повторный прогон — no-op (count уже равен total_lessons).
 *
 * Запуск (из app/):
 *   node --import tsx scripts/fix-phantom-lessons-aug2026.ts          # DRY-RUN (откат)
 *   node --import tsx scripts/fix-phantom-lessons-aug2026.ts --apply  # APPLY
 * DATABASE_URL должен указывать на прод-БД (через SSH-туннель).
 */
import { db } from "@/lib/db"
import { Prisma } from "@prisma/client"
import { countLessonsForGroup } from "@/lib/schedule/count-lessons"
import {
  recalcClientDiscounts,
  repriceSubscription,
} from "@/lib/discounts/recalc-client-discounts"

const TENANT = "3a3d76c6-32be-42d7-b35f-f7c1f8ab0502"
const PERIOD_YEAR = 2026
const PERIOD_MONTH = 8
const PERIOD_END = new Date(Date.UTC(2026, 7, 31)) // 31.08.2026 включительно
const APPLY = process.argv.includes("--apply")

class DryRunRollback extends Error {}

async function main() {
  const subs = await db.subscription.findMany({
    where: {
      tenantId: TENANT,
      type: "calendar",
      status: "pending",
      periodYear: PERIOD_YEAR,
      periodMonth: PERIOD_MONTH,
      deletedAt: null,
    },
    select: {
      id: true,
      clientId: true,
      groupId: true,
      startDate: true,
      totalLessons: true,
      lessonPrice: true,
      finalAmount: true,
      balance: true,
      discountPerLesson: true,
      discountSource: true,
      group: { select: { name: true } },
      client: { select: { firstName: true, lastName: true } },
    },
  })

  const toFix: { sub: (typeof subs)[number]; real: number }[] = []
  for (const s of subs) {
    const { count } = await countLessonsForGroup({
      tenantId: TENANT,
      groupId: s.groupId,
      rangeStart: s.startDate,
      rangeEnd: PERIOD_END,
    })
    if (count < s.totalLessons) toFix.push({ sub: s, real: count })
  }

  console.log(`\nРежим: ${APPLY ? "APPLY" : "DRY-RUN"}`)
  console.log(`Pending-абонементов августа: ${subs.length}, к правке: ${toFix.length}\n`)

  let sumFinalBefore = new Prisma.Decimal(0)
  let sumFinalAfter = new Prisma.Decimal(0)
  for (const { sub, real } of toFix) {
    const price = new Prisma.Decimal(sub.lessonPrice)
    const perLesson = Prisma.Decimal.min(new Prisma.Decimal(sub.discountPerLesson), price)
    const eff = Prisma.Decimal.max(new Prisma.Decimal(0), price.minus(perLesson))
    const projFinal = eff.mul(real)
    sumFinalBefore = sumFinalBefore.plus(new Prisma.Decimal(sub.finalAmount))
    sumFinalAfter = sumFinalAfter.plus(projFinal)
    const who = `${sub.client.lastName ?? ""} ${sub.client.firstName ?? ""}`.trim()
    console.log(
      `  ${who} | ${sub.group.name} | ${sub.totalLessons}→${real} | ` +
        `final ${sub.finalAmount}→~${projFinal} | ${sub.discountSource}`,
    )
  }
  console.log(
    `\nΣ finalAmount: ${sumFinalBefore} → ~${sumFinalAfter} (Δ ${sumFinalAfter.minus(sumFinalBefore)})`,
  )

  if (toFix.length === 0) {
    console.log("Нечего править — данные уже соответствуют факту.")
    return
  }

  // По одному клиенту на транзакцию: коммит per-client делает прогон устойчивым
  // к обрыву SSH-туннеля (падение теряет только текущего клиента) и быстрым
  // (маленькие транзакции укладываются в timeout). Idempotent: повторный запуск
  // пропускает уже исправленных (count == total_lessons → не попадают в toFix).
  const byClient = new Map<string, typeof toFix>()
  for (const item of toFix) {
    const arr = byClient.get(item.sub.clientId) ?? []
    arr.push(item)
    byClient.set(item.sub.clientId, arr)
  }

  let processedSubs = 0
  let processedClients = 0
  for (const [clientId, items] of byClient) {
    try {
      await db.$transaction(
        async (tx) => {
          for (const { sub, real } of items) {
            const price = new Prisma.Decimal(sub.lessonPrice)
            await tx.subscription.update({
              where: { id: sub.id },
              data: { totalLessons: real, totalAmount: price.mul(real) },
            })
          }
          // Инвариант тип 1/2 (мог смениться «самый дорогой» месяца), затем деньги.
          await recalcClientDiscounts(tx, { tenantId: TENANT, clientId, createdBy: null })
          for (const { sub } of items) {
            await repriceSubscription(tx, { tenantId: TENANT, subscriptionId: sub.id, createdBy: null })
          }
          if (!APPLY) throw new DryRunRollback()
        },
        { maxWait: 20_000, timeout: 60_000 },
      )
      processedSubs += items.length
      processedClients++
      if (APPLY) process.stdout.write(`\r  APPLY: клиентов ${processedClients}/${byClient.size}, абонементов ${processedSubs}   `)
    } catch (e) {
      if (e instanceof DryRunRollback) continue // dry-run: клиент откачен
      throw e // реальная ошибка — стоп; повторный (idempotent) запуск продолжит
    }
  }

  if (!APPLY) {
    console.log("\nDRY-RUN: все транзакции откачены, изменений в БД нет.")
    return
  }

  // APPLY: читаем итог
  const after = await db.subscription.findMany({
    where: { id: { in: toFix.map((t) => t.sub.id) } },
    select: { id: true, totalLessons: true, finalAmount: true, balance: true, discountAmount: true },
    orderBy: { finalAmount: "asc" },
  })
  const sumAfter = after.reduce((a, s) => a.plus(new Prisma.Decimal(s.finalAmount)), new Prisma.Decimal(0))
  const stillHigh = after.filter((s) => s.totalLessons > 8).length
  console.log(
    `\n\nAPPLY выполнен. Клиентов: ${processedClients}, абонементов: ${processedSubs}. ` +
      `Σ finalAmount (факт): ${sumAfter}. Осталось с >8 занятий: ${stillHigh}`,
  )
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("ОШИБКА:", e)
    await db.$disconnect()
    process.exit(1)
  })
