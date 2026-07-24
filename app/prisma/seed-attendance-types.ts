import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

// Системные типы посещений (tenantId = null) — каноническая матрица.
// Семантика и флаги системных строк заморожены (isFlagsLocked=true) —
// владелец организации может через UI настроек менять только:
//   - «Доступно инструктору» (availableToInstructor)
//   - «Доступно админу» (availableToAdmin)
//   - «Активен» (isActive) — скрыть/показать в выпадашках
//   - порядок (sortOrder)
// «Разрешить отчисление» (allowSubscriptionWithdrawal) у системных типов тоже
// настраивается каждой организацией, НО не в этой общей строке, а в пер-орг.
// оверрайде (attendance_type_withdrawal_overrides) — иначе один центр менял бы
// правило у всех. Здесь задаётся только ДЕФОЛТ (makeup_scheduled=false — его нельзя
// переопределить, остальные=true). Остальные поля (Расчёт, ЗП, %, План, Факт,
// Прогноз, название, код) нельзя менять — они зашиты в бизнес-логику.
async function main() {
  const types = [
    {
      code: "present",
      name: "Был",
      allowSubscriptionWithdrawal: true,
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
      // «Не был» — промежуточный статус: ребёнок не пришёл, оператор позже
      // уточнит причину (УП / Прогул / Отработка). Деньги и ЗП пока не двигаем,
      // чтобы не гонять баланс туда-сюда.
      code: "no_show",
      name: "Не был",
      allowSubscriptionWithdrawal: true,
      chargesSubscription: false,
      paysInstructor: false,
      countsAsRevenue: false,
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
      // Инструктор НЕ ставит сам — это решение администратора/владельца.
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
      // Нельзя отчислять абонемент, пока назначенная отработка не проведена/не
      // отменена. Флаг залочен и в UI (галочку не поставить).
      allowSubscriptionWithdrawal: false,
      sortOrder: 3,
    },
    {
      code: "excused",
      name: "Уваж. пропуск",
      allowSubscriptionWithdrawal: true,
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
      allowSubscriptionWithdrawal: true,
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
      allowSubscriptionWithdrawal: true,
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
      // «Отработано» — статус первоначального (пропущенного) занятия, когда
      // отработка проведена, и bulk-маркер «уже отработано в другой группе».
      // НЕ списывает и НЕ платит: фактические списание/ЗП висят на реальной
      // отработке (present + isMakeup=true). Ставится ТОЛЬКО системой (при «Был»
      // на занятии-отработке и при «Отметить всех»), вручную не выбирается —
      // поэтому для всех ролей закрыт и почти не изменяется.
      code: "makeup",
      name: "Отработано",
      allowSubscriptionWithdrawal: true,
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

    const canonical = {
      name: t.name,
      chargesSubscription: t.chargesSubscription,
      paysInstructor: t.paysInstructor,
      countsAsRevenue: t.countsAsRevenue,
      availableToAdmin: t.availableToAdmin,
      partOfPlan: t.partOfPlan,
      partOfFact: t.partOfFact,
      partOfForecast: t.partOfForecast,
      chargePercent: 100,
      isSystem: true,
      isFlagsLocked: true,
      sortOrder: t.sortOrder,
    }

    if (existing) {
      // Системные строки приводим к каноническим значениям при каждом seed —
      // иначе изменения в этом файле не доезжают до уже развёрнутых баз.
      // `availableToInstructor`, `isActive` и `allowSubscriptionWithdrawal` НЕ
      // переписываем: владелец мог подправить эти поля под себя в UI. Исключение —
      // «Назначена отработка»: у него отчисление принудительно запрещено.
      await db.attendanceType.update({
        where: { id: existing.id },
        data: {
          ...canonical,
          ...(t.code === "makeup_scheduled" ? { allowSubscriptionWithdrawal: false } : {}),
        },
      })
      console.log(`Updated: ${t.name} (${t.code})`)
    } else {
      await db.attendanceType.create({
        data: {
          tenantId: null,
          code: t.code,
          ...canonical,
          availableToInstructor: t.availableToInstructor,
          allowSubscriptionWithdrawal: t.allowSubscriptionWithdrawal ?? true,
          isActive: true,
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
