import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const db = new PrismaClient()

async function main() {
  console.log("Seeding database...")

  // Организация 1
  const org = await db.organization.create({
    data: {
      name: "Детский центр «Радуга»",
      legalName: 'ИП Малафеева А.А.',
      inn: "7712345678",
      phone: "+7 (999) 100-00-01",
      email: "raduga@example.com",
    },
  })

  // Филиал
  const branch = await db.branch.create({
    data: {
      tenantId: org.id,
      name: "Филиал на Ленина",
      address: "ул. Ленина, 42",
      workingHoursStart: "08:00",
      workingHoursEnd: "21:00",
      workingDays: [1, 2, 3, 4, 5, 6],
    },
  })

  // Кабинеты
  await db.room.createMany({
    data: [
      { tenantId: org.id, branchId: branch.id, name: "Зал 1", capacity: 15 },
      { tenantId: org.id, branchId: branch.id, name: "Зал 2", capacity: 15 },
      { tenantId: org.id, branchId: branch.id, name: "Кабинет 3", capacity: 6 },
    ],
  })

  const hash = (pwd: string) => bcrypt.hashSync(pwd, 10)

  // Владелец
  const owner = await db.employee.create({
    data: {
      tenantId: org.id,
      login: "owner",
      passwordHash: hash("demo123"),
      email: "owner@raduga.example.com",
      firstName: "Анна",
      lastName: "Малафеева",
      role: "owner",
    },
  })

  // Управляющий
  await db.employee.create({
    data: {
      tenantId: org.id,
      login: "manager",
      passwordHash: hash("demo123"),
      firstName: "Денис",
      lastName: "Шиманский",
      role: "manager",
    },
  })

  // Администратор
  await db.employee.create({
    data: {
      tenantId: org.id,
      login: "admin",
      passwordHash: hash("demo123"),
      firstName: "Петрова",
      lastName: "Наталья",
      role: "admin",
    },
  })

  // Инструктор
  await db.employee.create({
    data: {
      tenantId: org.id,
      login: "instructor",
      passwordHash: hash("demo123"),
      firstName: "Козлова",
      lastName: "Мария",
      role: "instructor",
    },
  })

  // Только чтение
  await db.employee.create({
    data: {
      tenantId: org.id,
      login: "viewer",
      passwordHash: hash("demo123"),
      firstName: "Иванов",
      lastName: "Пётр",
      role: "readonly",
    },
  })

  // Создаём User для владельца (для NextAuth)
  await db.user.create({
    data: {
      email: owner.email,
      name: `${owner.lastName} ${owner.firstName}`,
      employeeId: owner.id,
    },
  })

  console.log("Seed complete!")
  console.log("---")
  console.log("Демо-аккаунты (пароль: demo123):")
  console.log("  owner     — Владелец")
  console.log("  manager   — Управляющий")
  console.log("  admin     — Администратор")
  console.log("  instructor — Инструктор")
  console.log("  viewer    — Только чтение")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
