import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const today = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  // Найдём первого admin/manager как дефолтного исполнителя
  const defaultAssignee = await db.employee.findFirst({
    where: { tenantId, deletedAt: null, isActive: true, role: { in: ["admin", "manager", "owner"] } },
    select: { id: true },
    orderBy: { role: "asc" },
  })
  if (!defaultAssignee) return NextResponse.json({ error: "Нет сотрудников для назначения" }, { status: 400 })

  let created = 0

  // 1. Дата следующего контакта = сегодня
  const contactDueClients = await db.client.findMany({
    where: { tenantId, deletedAt: null, nextContactDate: today },
    select: { id: true, firstName: true, lastName: true },
  })
  for (const c of contactDueClients) {
    const exists = await db.task.findFirst({
      where: { tenantId, clientId: c.id, autoTrigger: "contact_date", dueDate: today, deletedAt: null },
    })
    if (!exists) {
      await db.task.create({
        data: {
          tenantId, title: `Позвонить: ${[c.lastName, c.firstName].filter(Boolean).join(" ")}`,
          type: "auto", autoTrigger: "contact_date", status: "pending",
          dueDate: today, assignedTo: defaultAssignee.id, clientId: c.id,
        },
      })
      created++
    }
  }

  // 2. Обещанная дата оплаты = сегодня
  const promisedPaymentClients = await db.client.findMany({
    where: { tenantId, deletedAt: null, promisedPaymentDate: today, clientBalance: { lt: 0 } },
    select: { id: true, firstName: true, lastName: true },
  })
  for (const c of promisedPaymentClients) {
    const exists = await db.task.findFirst({
      where: { tenantId, clientId: c.id, autoTrigger: "promised_payment", dueDate: today, deletedAt: null },
    })
    if (!exists) {
      await db.task.create({
        data: {
          tenantId, title: `Оплата обещана: ${[c.lastName, c.firstName].filter(Boolean).join(" ")}`,
          type: "auto", autoTrigger: "promised_payment", status: "pending",
          dueDate: today, assignedTo: defaultAssignee.id, clientId: c.id,
        },
      })
      created++
    }
  }

  // 3. ДР подопечных сегодня
  const birthdays = await db.ward.findMany({
    where: {
      tenantId,
      birthDate: { not: null },
    },
    select: { id: true, firstName: true, birthDate: true, clientId: true, client: { select: { firstName: true, lastName: true } } },
  })
  for (const w of birthdays) {
    if (!w.birthDate) continue
    if (w.birthDate.getMonth() === today.getMonth() && w.birthDate.getDate() === today.getDate()) {
      const exists = await db.task.findFirst({
        where: { tenantId, clientId: w.clientId, autoTrigger: "birthday", dueDate: today, deletedAt: null },
      })
      if (!exists) {
        const age = today.getFullYear() - w.birthDate.getFullYear()
        await db.task.create({
          data: {
            tenantId, title: `ДР: ${w.firstName} (${age} лет) — ${[w.client.lastName, w.client.firstName].filter(Boolean).join(" ")}`,
            type: "auto", autoTrigger: "birthday", status: "pending",
            dueDate: today, assignedTo: defaultAssignee.id, clientId: w.clientId,
          },
        })
        created++
      }
    }
  }

  // 4. Неотмеченные занятия вчера
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const unmarkedLessons = await db.lesson.findMany({
    where: {
      tenantId, date: yesterday, status: "scheduled",
      attendances: { none: {} },
    },
    select: { id: true, group: { select: { name: true, instructorId: true } } },
  })
  for (const l of unmarkedLessons) {
    const exists = await db.task.findFirst({
      where: { tenantId, autoTrigger: "unmarked_lesson", dueDate: today, deletedAt: null, title: { contains: l.group.name } },
    })
    if (!exists) {
      await db.task.create({
        data: {
          tenantId, title: `Отметить занятие: ${l.group.name}`,
          type: "auto", autoTrigger: "unmarked_lesson", status: "pending",
          dueDate: today, assignedTo: l.group.instructorId,
        },
      })
      created++
    }
  }

  // 5. Ожидание оплаты > 3 дней
  const threeDaysAgo = new Date(today)
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
  const awaitingClients = await db.client.findMany({
    where: {
      tenantId, deletedAt: null, funnelStatus: "awaiting_payment",
      updatedAt: { lt: threeDaysAgo },
    },
    select: { id: true, firstName: true, lastName: true },
  })
  for (const c of awaitingClients) {
    const exists = await db.task.findFirst({
      where: { tenantId, clientId: c.id, autoTrigger: "payment_due", dueDate: today, deletedAt: null },
    })
    if (!exists) {
      await db.task.create({
        data: {
          tenantId, title: `Напомнить об оплате: ${[c.lastName, c.firstName].filter(Boolean).join(" ")}`,
          type: "auto", autoTrigger: "payment_due", status: "pending",
          dueDate: today, assignedTo: defaultAssignee.id, clientId: c.id,
        },
      })
      created++
    }
  }

  return NextResponse.json({ created })
}
