import { db } from "@/lib/db"
import { consumedPackageLessonsMap, packageLessonsRemaining } from "@/lib/subscriptions/package-remaining"

/** Склонение «занятие/занятия/занятий». */
function lessonsWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return "занятие"
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "занятия"
  return "занятий"
}

/**
 * Исполнитель задачи «Пакет скоро истекает»: приоритет — активный администратор,
 * закреплённый за филиалом пакета; иначе первый управляющий/владелец/админ.
 * (Видимость задачи всё равно скоупится по Task.branchId — см. дашборд/задачи.)
 */
async function resolvePackageTaskAssignee(
  tenantId: string,
  branchId: string | null,
): Promise<string | null> {
  if (branchId) {
    const branchAdmin = await db.employee.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        role: "admin",
        employeeBranches: { some: { branchId } },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
    if (branchAdmin) return branchAdmin.id
  }
  const fallback = await db.employee.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      role: { in: ["admin", "manager", "owner"] },
    },
    select: { id: true },
    orderBy: { role: "asc" },
  })
  return fallback?.id ?? null
}

/**
 * Уведомления + задача о скором истечении пакетного абонемента.
 *
 * Для каждой организации с subscriptionType='package' и положительным
 * packageExpiryNotifyDaysBefore берём пакеты (active/pending) с expiresAt в окне
 * (today, today + N] и ОСТАТКОМ ЗАНЯТИЙ > 0 (totalLessons − израсходовано).
 * Критерий — несгоревшие занятия, а НЕ balance>0: полностью оплаченный пакет с
 * невыгоревшими занятиями — как раз главный случай (занятия вот-вот сгорят).
 *
 * По каждому такому пакету:
 *  - in-app уведомление владельцу + управляющим + администраторам (колокольчик);
 *    entityType='Client' + entityId=clientId — клик ведёт на карточку клиента
 *    (раньше был мёртвый линк: 'subscription' в нижнем регистре + id абонемента);
 *  - задача (autoTrigger='package_expiring') администратору филиала пакета,
 *    срок = дата сгорания, привязка к клиенту и филиалу.
 */
export async function notifyExpiringPackages(now: Date = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)

  const orgs = await db.organization.findMany({
    where: {
      subscriptionType: "package",
      packageExpiryNotifyDaysBefore: { gt: 0 },
    },
    select: { id: true, packageExpiryNotifyDaysBefore: true },
  })

  let totalCreated = 0
  let tasksCreated = 0
  for (const org of orgs) {
    const windowEnd = new Date(today.getTime() + org.packageExpiryNotifyDaysBefore * 24 * 60 * 60 * 1000)

    const subs = await db.subscription.findMany({
      where: {
        tenantId: org.id,
        type: "package",
        status: { in: ["active", "pending"] },
        expiresAt: { gte: today, lte: windowEnd },
        deletedAt: null,
      },
      select: {
        id: true,
        clientId: true,
        totalLessons: true,
        expiresAt: true,
        client: { select: { firstName: true, lastName: true } },
        direction: { select: { name: true } },
        group: { select: { branchId: true } },
      },
    })
    if (subs.length === 0) continue

    // Остаток занятий по всем пакетам-кандидатам одним запросом.
    const consumedById = await consumedPackageLessonsMap(
      db,
      org.id,
      subs.map((s) => s.id),
    )
    const expiring = subs.filter(
      (s) => packageLessonsRemaining(s.totalLessons, consumedById.get(s.id) ?? 0) > 0,
    )
    if (expiring.length === 0) continue

    const recipients = await db.employee.findMany({
      where: {
        tenantId: org.id,
        isActive: true,
        deletedAt: null,
        role: { in: ["owner", "manager", "admin"] },
      },
      select: { id: true },
    })

    for (const sub of expiring) {
      const remaining = packageLessonsRemaining(sub.totalLessons, consumedById.get(sub.id) ?? 0)
      const clientName = [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ")
      const expDate = sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString("ru-RU") : "—"
      const message = `${sub.direction.name} — истекает ${expDate}, осталось ${remaining} ${lessonsWord(remaining)}`

      // === Уведомление (колокольчик) ===
      // Идемпотентность: то же сообщение по этому клиенту за последние 24 ч
      // (сообщение кодирует направление/дату/остаток → фактически «на пакет»).
      if (recipients.length > 0) {
        const recent = await db.notification.findFirst({
          where: {
            tenantId: org.id,
            type: "package_expiring",
            entityId: sub.clientId,
            message,
            createdAt: { gte: yesterday },
          },
          select: { id: true },
        })
        if (!recent) {
          await db.notification.createMany({
            data: recipients.map((r) => ({
              tenantId: org.id,
              employeeId: r.id,
              type: "package_expiring" as const,
              title: `Истекает пакет: ${clientName}`,
              message,
              entityType: "Client",
              entityId: sub.clientId,
            })),
          })
          totalCreated += recipients.length
        }
      }

      // === Задача администратору филиала ===
      // Идемпотентность: активная задача по этому клиенту с тем же сроком
      // (дата сгорания) уже есть — не плодим.
      const dueDate = sub.expiresAt ? new Date(sub.expiresAt) : today
      const existingTask = await db.task.findFirst({
        where: {
          tenantId: org.id,
          autoTrigger: "package_expiring",
          clientId: sub.clientId,
          dueDate,
          status: "pending",
          deletedAt: null,
        },
        select: { id: true },
      })
      if (!existingTask) {
        const assigneeId = await resolvePackageTaskAssignee(org.id, sub.group.branchId)
        if (assigneeId) {
          await db.task.create({
            data: {
              tenantId: org.id,
              title: `Пакет истекает: ${clientName}`,
              description: `${message}. Продлите пакет или используйте оставшиеся занятия до сгорания.`,
              type: "auto",
              autoTrigger: "package_expiring",
              status: "pending",
              dueDate,
              assignedTo: assigneeId,
              clientId: sub.clientId,
              branchId: sub.group.branchId,
            },
          })
          tasksCreated += 1
        }
      }
    }
  }

  return { notifications: totalCreated, tasks: tasksCreated }
}
