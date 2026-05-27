import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

// Системные типы посещений (tenantId = null) — каноническая матрица.
// Семантика и флаги системных строк заморожены (isFlagsLocked=true) —
// владелец организации может через UI настроек менять только:
//   - «Доступно педагогу» (availableToInstructor)
//   - «Доступно админу» (availableToAdmin)
//   - «Активен» (isActive) — скрыть/показать в выпадашках
//   - порядок (sortOrder)
// Остальные поля (Расчёт, ЗП, %, План, Факт, Прогноз, название, код)
// нельзя менять — они зашиты в бизнес-логику.
async function main() {
  const types = [
    {
      code: "present",
      name: "Был",
      chargesSubscription: true,
      paysInstructor: true,
      countsAsRevenue: true,
      availableToInstructor: true,
      availableToAdmin: true,
      partOfPlan: true,
      partOfFact: true,
      partOfForecast: true,
      sortOrder: 1,
    },
    {
      code: "no_show",
      name: "Не был",
      chargesSubscription: true,
      paysInstructor: false,
      countsAsRevenue: true,
      availableToInstructor: true,
      availableToAdmin: true,
      partOfPlan: true,
      partOfFact: false,
      partOfForecast: true,
      sortOrder: 2,
    },
    {
      // «Назначена отработка» — статус на пропущенном занятии, когда админ
      // выбрал, на каком занятии в будущем будет отрабатывать ребёнок.
      // Списание происходит при фактическом проведении отработки, не здесь.
      // Педагог НЕ ставит сам — это решение администратора/владельца.
      code: "makeup_scheduled",
      name: "Назначена отработка",
      chargesSubscription: false,
      paysInstructor: false,
      countsAsRevenue: false,
      availableToInstructor: false,
      availableToAdmin: true,
      partOfPlan: true,
      partOfFact: false,
      partOfForecast: false,
      sortOrder: 3,
    },
    {
      code: "excused",
      name: "Уваж. пропуск",
      chargesSubscription: false,
      paysInstructor: false,
      countsAsRevenue: false,
      availableToInstructor: false,
      availableToAdmin: true,
      partOfPlan: true,
      partOfFact: false,
      partOfForecast: false,
      sortOrder: 4,
    },
    {
      code: "absent",
      name: "Прогул",
      chargesSubscription: true,
      paysInstructor: true,
      countsAsRevenue: true,
      availableToInstructor: false,
      availableToAdmin: true,
      partOfPlan: true,
      partOfFact: false,
      partOfForecast: true,
      sortOrder: 5,
    },
    {
      code: "recalculation",
      name: "Перерасчёт",
      chargesSubscription: false,
      paysInstructor: false,
      countsAsRevenue: false,
      availableToInstructor: false,
      availableToAdmin: true,
      partOfPlan: false,
      partOfFact: false,
      partOfForecast: false,
      sortOrder: 6,
    },
    {
      // «Отработка» — маркер для bulk-операции «уже отработано в другой группе»:
      // НЕ списывает и НЕ платит, потому что фактические списание/ЗП происходят
      // при создании реальной отработки (present + isMakeup=true). Никем не ставится
      // вручную, поэтому для всех ролей закрыт.
      code: "makeup",
      name: "Отработка",
      chargesSubscription: false,
      paysInstructor: false,
      countsAsRevenue: false,
      availableToInstructor: false,
      availableToAdmin: false,
      partOfPlan: false,
      partOfFact: true,
      partOfForecast: false,
      sortOrder: 7,
    },
  ]

  for (const t of types) {
    const existing = await db.attendanceType.findFirst({
      where: { code: t.code, tenantId: null },
    })

    if (existing) {
      console.log(`Exists: ${t.name} (${t.code})`)
    } else {
      await db.attendanceType.create({
        data: {
          tenantId: null,
          code: t.code,
          name: t.name,
          chargesSubscription: t.chargesSubscription,
          paysInstructor: t.paysInstructor,
          countsAsRevenue: t.countsAsRevenue,
          availableToInstructor: t.availableToInstructor,
          availableToAdmin: t.availableToAdmin,
          partOfPlan: t.partOfPlan,
          partOfFact: t.partOfFact,
          partOfForecast: t.partOfForecast,
          chargePercent: 100,
          isSystem: true,
          isFlagsLocked: true,
          isActive: true,
          sortOrder: t.sortOrder,
        },
      })
      console.log(`Created: ${t.name} (${t.code})`)
    }
  }

  console.log("Attendance types seeded!")
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
