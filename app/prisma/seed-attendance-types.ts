import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

// Системные типы посещений (tenantId = null) — базовая матрица.
// Владелец организации может в settings/attendance-matrix:
//   - переименовать любую строку (включая системные)
//   - перенастроить любые флаги
//   - добавить свои строки (создаются с tenantId текущей организации)
// Код (code) у системных строк фиксирован и не меняется — на нём завязана бизнес-логика.
async function main() {
  const types = [
    {
      code: "present",
      name: "Был",
      chargesSubscription: true,
      paysInstructor: true,
      countsAsRevenue: true,
      availableToInstructor: true,
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
      partOfPlan: true,
      partOfFact: false,
      partOfForecast: true,
      sortOrder: 2,
    },
    {
      code: "excused",
      name: "Уваж. пропуск",
      chargesSubscription: false,
      paysInstructor: false,
      countsAsRevenue: false,
      availableToInstructor: false,
      partOfPlan: true,
      partOfFact: false,
      partOfForecast: false,
      sortOrder: 3,
    },
    {
      code: "absent",
      name: "Прогул",
      chargesSubscription: true,
      paysInstructor: true,
      countsAsRevenue: true,
      availableToInstructor: false,
      partOfPlan: true,
      partOfFact: false,
      partOfForecast: true,
      sortOrder: 4,
    },
    {
      code: "recalculation",
      name: "Перерасчёт",
      chargesSubscription: false,
      paysInstructor: false,
      countsAsRevenue: false,
      availableToInstructor: false,
      partOfPlan: false,
      partOfFact: false,
      partOfForecast: false,
      sortOrder: 5,
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
      partOfPlan: true,
      partOfFact: false,
      partOfForecast: false,
      isFlagsLocked: true,
      sortOrder: 3,
    },
    {
      // «Отработка» — маркер для bulk-операции «уже отработано в другой группе»:
      // НЕ списывает и НЕ платит, потому что фактические списание/ЗП происходят
      // при создании реальной отработки (present + isMakeup=true).
      code: "makeup",
      name: "Отработка",
      chargesSubscription: false,
      paysInstructor: false,
      countsAsRevenue: false,
      availableToInstructor: false,
      partOfPlan: false,
      partOfFact: true,
      partOfForecast: false,
      isFlagsLocked: true,
      sortOrder: 6,
    },
  ]

  for (const t of types) {
    const existing = await db.attendanceType.findFirst({
      where: { code: t.code, tenantId: null },
    })

    if (existing) {
      await db.attendanceType.update({
        where: { id: existing.id },
        data: {
          // Имя на системной строке оставляем как есть, чтобы не затирать ручные переименования владельцами.
          // Флаги тоже не перетираем — миграция уже выставила дефолты для существующих строк.
          // Этот блок отвечает только за создание недостающих системных строк (no_show, excused).
        },
      })
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
          partOfPlan: t.partOfPlan,
          partOfFact: t.partOfFact,
          partOfForecast: t.partOfForecast,
          chargePercent: 100,
          isSystem: true,
          isFlagsLocked: ("isFlagsLocked" in t ? Boolean((t as { isFlagsLocked?: boolean }).isFlagsLocked) : false),
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
