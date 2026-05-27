import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import {
  isTriggerEnabled,
  parseTriggerSettings,
} from "@/lib/tasks/trigger-settings"

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tenantId = session.user.tenantId
  const today = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))

  // Найдём первого admin/manager как дефолтного исполнителя
  const defaultAssignee = await db.employee.findFirst({
    where: { tenantId, deletedAt: null, isActive: true, role: { in: ["admin", "manager", "owner"] } },
    select: { id: true },
    orderBy: { role: "asc" },
  })
  if (!defaultAssignee) return NextResponse.json({ error: "Нет сотрудников для назначения" }, { status: 400 })

  // Ф6.2: настройки автотриггеров. Пустой массив или отсутствие триггера в нём
  // = триггер включён (обратная совместимость).
  const orgSettings = await db.organization.findUnique({
    where: { id: tenantId },
    select: { taskTriggerSettings: true },
  })
  const triggerSettings = parseTriggerSettings(orgSettings?.taskTriggerSettings)
  const todayLocal = new Date()

  let created = 0

  // 1. Дата следующего контакта = сегодня
  if (isTriggerEnabled("contact_date", triggerSettings, todayLocal)) {
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
  }

  // 2. Обещанная дата оплаты = сегодня
  if (isTriggerEnabled("promised_payment", triggerSettings, todayLocal)) {
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
  }

  // 3. ДР подопечных сегодня
  if (isTriggerEnabled("birthday", triggerSettings, todayLocal)) {
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
  }

  // 4. Неотмеченные занятия вчера
  if (isTriggerEnabled("unmarked_lesson", triggerSettings, todayLocal)) {
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
  }

  // 5. Ожидание оплаты > 3 дней
  if (isTriggerEnabled("payment_due", triggerSettings, todayLocal)) {
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
  }

  // 6. «Не был» старше 3 дней — переходный статус не уточнён администратором.
  if (isTriggerEnabled("no_show_review", triggerSettings, todayLocal)) {
    const threeDaysAgo = new Date(today)
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    // Учитываем только обычные no_show (НЕ виртуальные отработки — у тех своя
    // задача missed_makeup создаётся отдельно при отметке «Не был» на L2).
    const pendingNoShows = await db.attendance.findMany({
      where: {
        tenantId,
        attendanceType: { code: "no_show" },
        isMakeup: false,
        lesson: { date: { lte: threeDaysAgo } },
      },
      include: {
        client: { select: { firstName: true, lastName: true } },
        lesson: {
          select: {
            id: true,
            date: true,
            group: {
              select: { name: true, direction: { select: { name: true } } },
            },
          },
        },
      },
    })

    // Подгружаем имена подопечных одним запросом — у Attendance нет relation на Ward.
    const wardIds = pendingNoShows.map((a) => a.wardId).filter((x): x is string => !!x)
    const wards = wardIds.length
      ? await db.ward.findMany({
          where: { id: { in: wardIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : []

    for (const att of pendingNoShows) {
      const ward = att.wardId ? wards.find((w) => w.id === att.wardId) : null
      const wardName = ward ? [ward.lastName, ward.firstName].filter(Boolean).join(" ") : ""
      const clientName = [att.client.lastName, att.client.firstName].filter(Boolean).join(" ")
      const childDisplayName = wardName || clientName || "Без имени"
      const lessonDateStr = att.lesson.date.toLocaleDateString("ru-RU")
      const directionName = att.lesson.group.direction.name
      const groupName = att.lesson.group.name

      // Идемпотентность: ищем активную задачу для этой attendance.
      // Маркер attendance_id в description — не visible в title для админа.
      const marker = `[att=${att.id}]`
      const description =
        `Педагог отметил «Не был» на занятии «${directionName} — ${groupName}» ` +
        `${lessonDateStr}. Уточните причину и переведите в «Уваж. пропуск», ` +
        `«Прогул» или «Назначена отработка». ${marker}`

      const exists = await db.task.findFirst({
        where: {
          tenantId,
          autoTrigger: "no_show_review",
          status: "pending",
          deletedAt: null,
          description: { contains: marker },
        },
      })
      if (exists) continue

      await db.task.create({
        data: {
          tenantId,
          title: `Уточнить «Не был»: ${childDisplayName} (${lessonDateStr})`,
          description,
          type: "auto",
          autoTrigger: "no_show_review",
          status: "pending",
          dueDate: today,
          assignedTo: defaultAssignee.id,
          clientId: att.clientId,
        },
      })
      created++
    }
  }

  return NextResponse.json({ created })
}
