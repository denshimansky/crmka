// Одноразовый скрипт для восстановления Subscription.wardId, потерянного
// багом #72: PATCH /api/subscriptions/[id] затирал wardId на null при любом
// запросе без явного поля (withdraw, close, edit).
//
// Берём GroupEnrollment с тем же clientId+groupId и непустым wardId
// (зачисление содержит ту же связь ребёнка с группой, что и абонемент).
// Если у клиента в этой группе несколько зачислений с разными wardId —
// случай неоднозначный, такие пропускаем и логируем.
//
// Запуск: npx tsx prisma/restore-subscription-ward-ids.ts
// Не использует transactions — каждый апдейт независим, можно прерывать.

import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

async function main() {
  const broken = await db.subscription.findMany({
    where: {
      wardId: null,
      deletedAt: null,
      client: { wards: { some: {} } },
    },
    select: {
      id: true,
      tenantId: true,
      clientId: true,
      groupId: true,
      directionId: true,
      periodYear: true,
      periodMonth: true,
      status: true,
    },
  })

  console.info(`Найдено абонементов с wardId=null и существующими подопечными у клиента: ${broken.length}`)

  let restored = 0
  let ambiguous = 0
  let noEnrollment = 0

  for (const sub of broken) {
    const enrollmentWards = await db.groupEnrollment.findMany({
      where: {
        tenantId: sub.tenantId,
        clientId: sub.clientId,
        groupId: sub.groupId,
        wardId: { not: null },
        deletedAt: null,
      },
      select: { wardId: true },
    })

    const uniqueWardIds = Array.from(new Set(enrollmentWards.map((e) => e.wardId).filter((w): w is string => !!w)))

    if (uniqueWardIds.length === 0) {
      // Нет зачислений с wardId — пробуем взять единственного подопечного клиента.
      const clientWards = await db.ward.findMany({
        where: { clientId: sub.clientId, tenantId: sub.tenantId },
        select: { id: true },
      })
      if (clientWards.length === 1) {
        await db.subscription.update({
          where: { id: sub.id },
          data: { wardId: clientWards[0].id },
        })
        restored++
        console.info(`[restored ${sub.id}] sub period=${sub.periodMonth}/${sub.periodYear} status=${sub.status} → wardId=${clientWards[0].id} (единственный подопечный клиента)`)
      } else {
        noEnrollment++
        console.warn(`[skip ${sub.id}] нет зачислений с wardId; у клиента ${clientWards.length} подопечных — неоднозначно`)
      }
      continue
    }

    if (uniqueWardIds.length > 1) {
      ambiguous++
      console.warn(`[skip ${sub.id}] в группе несколько разных подопечных (${uniqueWardIds.length}) — неоднозначно`)
      continue
    }

    await db.subscription.update({
      where: { id: sub.id },
      data: { wardId: uniqueWardIds[0] },
    })
    restored++
    console.info(`[restored ${sub.id}] sub period=${sub.periodMonth}/${sub.periodYear} status=${sub.status} → wardId=${uniqueWardIds[0]}`)
  }

  console.info("")
  console.info("=== Итого ===")
  console.info(`Восстановлено: ${restored}`)
  console.info(`Пропущено (несколько подопечных в группе): ${ambiguous}`)
  console.info(`Пропущено (нет зачислений / много подопечных у клиента): ${noEnrollment}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
