/**
 * Разовый бэкфилл: создаёт недостающие GroupEnrollment для уже существующих
 * «живых» (pending/active) абонементов.
 *
 * Зачем: до фикса POST /api/subscriptions создавал Subscription, но не создавал
 * GroupEnrollment. Из-за этого абонемент активный и привязан к группе, а ребёнка
 * в группе и в таблицах посещений нет. Фикс в коде чинит только НОВЫЕ абонементы;
 * этот скрипт лечит уже накопленные данные.
 *
 * Что делает (зеркалит логику move-to-awaiting-payment / activateSubscription):
 *   для каждого pending/active абонемента без GroupEnrollment по ключу
 *   (tenantId, groupId, clientId, wardId) создаёт GroupEnrollment:
 *     paymentStatus = active   (если абонемент active)
 *                   = awaiting_payment (если pending)
 *     isActive  = true
 *     enrolledAt = subscription.startDate
 *
 * Что НЕ делает: не трогает существующие зачисления (в т.ч. withdrawn/inactive) —
 * только сообщает о них для ручного разбора. Не меняет paymentStatus у уже
 * существующих записей.
 *
 * Запуск:
 *   DRY-RUN (по умолчанию, ничего не пишет):
 *     npx tsx scripts/backfill-group-enrollments.ts
 *   ПРИМЕНИТЬ:
 *     npx tsx scripts/backfill-group-enrollments.ts --apply
 *
 * Внимание: запускать с тем же DATABASE_URL, что и миграции (роль-владелец БД),
 * либо учесть RLS — скрипт сам выставляет app.current_tenant_id по каждому тенанту.
 */

import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()
const APPLY = process.argv.includes("--apply")

type SubRow = {
  id: string
  groupId: string
  clientId: string
  wardId: string | null
  status: string
  startDate: Date
}

const key = (groupId: string, clientId: string, wardId: string | null) =>
  `${groupId}|${clientId}|${wardId ?? ""}`

async function main() {
  console.log(
    `\n=== Бэкфилл GroupEnrollment ===  режим: ${APPLY ? "APPLY (запись)" : "DRY-RUN (без записи)"}\n`,
  )

  // Тенанты, у которых есть живые абонементы.
  const tenants = await db.subscription.findMany({
    where: { status: { in: ["pending", "active"] }, deletedAt: null },
    distinct: ["tenantId"],
    select: { tenantId: true },
  })

  let totalLive = 0
  let totalMissing = 0
  let totalInactiveExisting = 0
  let totalCreated = 0

  for (const { tenantId } of tenants) {
    // Каждый тенант — в своей транзакции с установленным RLS-контекстом.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`

      const subs = (await tx.subscription.findMany({
        where: { tenantId, status: { in: ["pending", "active"] }, deletedAt: null },
        select: {
          id: true,
          groupId: true,
          clientId: true,
          wardId: true,
          status: true,
          startDate: true,
        },
      })) as SubRow[]

      const enrollments = await tx.groupEnrollment.findMany({
        where: { tenantId },
        select: { groupId: true, clientId: true, wardId: true, isActive: true },
      })

      const activeKeys = new Set<string>()
      const anyKeys = new Set<string>()
      for (const e of enrollments) {
        const k = key(e.groupId, e.clientId, e.wardId)
        anyKeys.add(k)
        if (e.isActive) activeKeys.add(k)
      }

      for (const s of subs) {
        totalLive++
        const k = key(s.groupId, s.clientId, s.wardId)

        if (activeKeys.has(k)) continue // зачисление уже есть и активно — ОК

        if (anyKeys.has(k)) {
          // Зачисление есть, но isActive=false (отчислен/выбыл). Не трогаем —
          // это могло быть осознанное отчисление. Сообщаем для ручного разбора.
          totalInactiveExisting++
          console.log(
            `  [INACTIVE] sub=${s.id} tenant=${tenantId} group=${s.groupId} client=${s.clientId} ward=${s.wardId ?? "-"} — есть неактивное зачисление, пропускаю`,
          )
          continue
        }

        // Зачисления нет вообще — это и есть симптом бага.
        totalMissing++
        const paymentStatus = s.status === "active" ? "active" : "awaiting_payment"
        console.log(
          `  [MISSING ] sub=${s.id} status=${s.status} -> создать enrollment(paymentStatus=${paymentStatus}, enrolledAt=${s.startDate.toISOString().slice(0, 10)})`,
        )

        if (APPLY) {
          await tx.groupEnrollment.create({
            data: {
              tenantId,
              groupId: s.groupId,
              clientId: s.clientId,
              wardId: s.wardId,
              paymentStatus,
              isActive: true,
              enrolledAt: s.startDate,
            },
          })
          totalCreated++
          // чтобы два абонемента одного ребёнка в одну группу не создали дубль
          activeKeys.add(k)
          anyKeys.add(k)
        } else {
          // в dry-run тоже резервируем ключ, чтобы не считать один и тот же
          // (group,client,ward) дважды при нескольких живых абонементах
          activeKeys.add(k)
          anyKeys.add(k)
        }
      }
    })
  }

  console.log(`\n=== Итог ===`)
  console.log(`Тенантов с живыми абонементами: ${tenants.length}`)
  console.log(`Живых абонементов проверено:    ${totalLive}`)
  console.log(`Без зачисления (создать):       ${totalMissing}`)
  console.log(`С неактивным зачислением:        ${totalInactiveExisting} (пропущены)`)
  if (APPLY) {
    console.log(`СОЗДАНО зачислений:             ${totalCreated}`)
  } else {
    console.log(`\nЭто DRY-RUN — ничего не записано. Для применения: добавьте --apply`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
