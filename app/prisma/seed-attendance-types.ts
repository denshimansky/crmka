import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

async function main() {
  // Системные типы посещений (tenant_id = null)
  const types = [
    { name: "Явка", code: "present", chargesSubscription: true, paysInstructor: true, countsAsRevenue: true, sortOrder: 1 },
    { name: "Прогул", code: "absent", chargesSubscription: true, paysInstructor: false, countsAsRevenue: true, sortOrder: 2 },
    { name: "Перерасчёт", code: "recalculation", chargesSubscription: false, paysInstructor: false, countsAsRevenue: false, sortOrder: 3 },
    { name: "Отработка", code: "makeup", chargesSubscription: false, paysInstructor: false, countsAsRevenue: false, sortOrder: 4 },
  ]

  for (const t of types) {
    await db.attendanceType.upsert({
      where: { id: t.code }, // Will fail, use findFirst
      update: {},
      create: {
        tenantId: null,
        name: t.name,
        code: t.code,
        chargesSubscription: t.chargesSubscription,
        paysInstructor: t.paysInstructor,
        countsAsRevenue: t.countsAsRevenue,
        isSystem: true,
        isActive: true,
        sortOrder: t.sortOrder,
      },
    }).catch(async () => {
      // upsert won't work without unique on code, use findFirst + create
      const existing = await db.attendanceType.findFirst({
        where: { code: t.code, tenantId: null },
      })
      if (!existing) {
        await db.attendanceType.create({
          data: {
            tenantId: null,
            name: t.name,
            code: t.code,
            chargesSubscription: t.chargesSubscription,
            paysInstructor: t.paysInstructor,
            countsAsRevenue: t.countsAsRevenue,
            isSystem: true,
            isActive: true,
            sortOrder: t.sortOrder,
          },
        })
        console.log(`Created: ${t.name}`)
      } else {
        console.log(`Exists: ${t.name}`)
      }
    })
  }

  console.log("Attendance types seeded!")
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
