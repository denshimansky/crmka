import { db } from "@/lib/db"

/**
 * Создаёт in-app уведомления о скором истечении пакетного абонемента.
 *
 * Для каждой организации с subscriptionType='package' и положительным
 * packageExpiryNotifyDaysBefore: находим активные пакеты с
 * expiresAt в окне (today, today + N], для которых ещё не было уведомления
 * за последние 24 часа.
 *
 * Получатели: владелец + управляющие + администраторы тенанта.
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
  for (const org of orgs) {
    const windowEnd = new Date(today.getTime() + org.packageExpiryNotifyDaysBefore * 24 * 60 * 60 * 1000)

    const subs = await db.subscription.findMany({
      where: {
        tenantId: org.id,
        type: "package",
        status: { in: ["active", "pending"] },
        expiresAt: { gte: today, lte: windowEnd },
        balance: { gt: 0 },
        deletedAt: null,
      },
      include: {
        client: { select: { firstName: true, lastName: true } },
        direction: { select: { name: true } },
      },
    })
    if (subs.length === 0) continue

    const recipients = await db.employee.findMany({
      where: {
        tenantId: org.id,
        isActive: true,
        deletedAt: null,
        role: { in: ["owner", "manager", "admin"] },
      },
      select: { id: true },
    })
    if (recipients.length === 0) continue

    for (const sub of subs) {
      // Идемпотентность: пропускаем, если уведомление о ЭТОМ абонементе уже было
      // создано за последние 24 часа (для любого получателя).
      const recent = await db.notification.findFirst({
        where: {
          tenantId: org.id,
          type: "package_expiring",
          entityType: "subscription",
          entityId: sub.id,
          createdAt: { gte: yesterday },
        },
        select: { id: true },
      })
      if (recent) continue

      const clientName = [sub.client.lastName, sub.client.firstName].filter(Boolean).join(" ")
      const expDate = sub.expiresAt
        ? new Date(sub.expiresAt).toLocaleDateString("ru-RU")
        : "—"

      await db.notification.createMany({
        data: recipients.map((r) => ({
          tenantId: org.id,
          employeeId: r.id,
          type: "package_expiring" as const,
          title: `Истекает пакет: ${clientName}`,
          message: `${sub.direction.name} — истекает ${expDate}, остаток ${Number(sub.balance).toLocaleString("ru-RU")} ₽`,
          entityType: "subscription",
          entityId: sub.id,
        })),
      })
      totalCreated += recipients.length
    }
  }

  return { notifications: totalCreated }
}
