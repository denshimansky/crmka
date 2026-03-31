import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

async function main() {
  // 14 предустановленных категорий расходов (tenant_id = null, системные)
  const categories = [
    { name: "Аренда", isSalary: false, isVariable: false, sortOrder: 1 },
    { name: "Коммунальные услуги", isSalary: false, isVariable: false, sortOrder: 2 },
    { name: "Зарплата инструкторов", isSalary: true, isVariable: true, sortOrder: 3 },
    { name: "Зарплата администраторов", isSalary: true, isVariable: false, sortOrder: 4 },
    { name: "Зарплата управляющего", isSalary: true, isVariable: false, sortOrder: 5 },
    { name: "Маркетинг и реклама", isSalary: false, isVariable: false, sortOrder: 6 },
    { name: "Канцтовары и расходники", isSalary: false, isVariable: true, sortOrder: 7 },
    { name: "Оборудование", isSalary: false, isVariable: false, sortOrder: 8 },
    { name: "Связь и интернет", isSalary: false, isVariable: false, sortOrder: 9 },
    { name: "Бухгалтерия", isSalary: false, isVariable: false, sortOrder: 10 },
    { name: "Налоги и взносы", isSalary: false, isVariable: false, sortOrder: 11 },
    { name: "Хозяйственные расходы", isSalary: false, isVariable: false, sortOrder: 12 },
    { name: "Обучение персонала", isSalary: false, isVariable: false, sortOrder: 13 },
    { name: "Прочие расходы", isSalary: false, isVariable: false, sortOrder: 14 },
  ]

  for (const c of categories) {
    const existing = await db.expenseCategory.findFirst({
      where: { name: c.name, tenantId: null },
    })
    if (!existing) {
      await db.expenseCategory.create({
        data: {
          tenantId: null,
          name: c.name,
          isSalary: c.isSalary,
          isVariable: c.isVariable,
          isSystem: true,
          isActive: true,
          sortOrder: c.sortOrder,
        },
      })
      console.log(`Created: ${c.name}`)
    } else {
      console.log(`Exists: ${c.name}`)
    }
  }

  console.log("Expense categories seeded!")
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
