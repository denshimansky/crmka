import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { z } from "zod"

const mergeSchema = z.object({
  sourceId: z.string().uuid("sourceId должен быть UUID"),
  targetId: z.string().uuid("targetId должен быть UUID"),
})

// POST /api/clients/merge — объединение дубликатов
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (session.user.role !== "owner" && session.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = mergeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || "Ошибка валидации" }, { status: 400 })
  }

  const { sourceId, targetId } = parsed.data
  const tenantId = session.user.tenantId

  if (sourceId === targetId) {
    return NextResponse.json({ error: "Нельзя объединить клиента с самим собой" }, { status: 400 })
  }

  // Проверяем что оба клиента существуют и принадлежат тому же тенанту
  const [source, target] = await Promise.all([
    db.client.findFirst({ where: { id: sourceId, tenantId, deletedAt: null }, include: { wards: true } }),
    db.client.findFirst({ where: { id: targetId, tenantId, deletedAt: null }, include: { wards: true } }),
  ])

  if (!source) return NextResponse.json({ error: "Исходный клиент не найден" }, { status: 404 })
  if (!target) return NextResponse.json({ error: "Целевой клиент не найден" }, { status: 404 })

  // Получить wardIds у target для проверки дубликатов
  const targetWardNames = new Set(
    target.wards.map((w) => `${w.firstName}|${w.lastName || ""}`.toLowerCase())
  )

  const result = await db.$transaction(async (tx) => {
    // 1. Перенести связанные записи на target
    await tx.groupEnrollment.updateMany({
      where: { clientId: sourceId, tenantId },
      data: { clientId: targetId },
    })

    await tx.subscription.updateMany({
      where: { clientId: sourceId, tenantId },
      data: { clientId: targetId },
    })

    await tx.payment.updateMany({
      where: { clientId: sourceId, tenantId },
      data: { clientId: targetId },
    })

    await tx.attendance.updateMany({
      where: { clientId: sourceId, tenantId },
      data: { clientId: targetId },
    })

    await tx.task.updateMany({
      where: { clientId: sourceId, tenantId },
      data: { clientId: targetId },
    })

    await tx.communication.updateMany({
      where: { clientId: sourceId, tenantId },
      data: { clientId: targetId },
    })

    await tx.callCampaignItem.updateMany({
      where: { clientId: sourceId },
      data: { clientId: targetId },
    })

    await tx.trialLesson.updateMany({
      where: { clientId: sourceId, tenantId },
      data: { clientId: targetId },
    })

    await tx.clientBalanceTransaction.updateMany({
      where: { clientId: sourceId, tenantId },
      data: { clientId: targetId },
    })

    // 2. Перенести подопечных (если нет дублей по имени)
    for (const ward of source.wards) {
      const key = `${ward.firstName}|${ward.lastName || ""}`.toLowerCase()
      if (!targetWardNames.has(key)) {
        await tx.ward.update({
          where: { id: ward.id },
          data: { clientId: targetId },
        })
      }
    }

    // 3. Объединить данные: заполнить пустые поля у target из source
    const updateData: Record<string, string | undefined> = {}
    if (!target.phone && source.phone) updateData.phone = source.phone
    if (!target.phone2 && source.phone2) updateData.phone2 = source.phone2
    if (!target.email && source.email) updateData.email = source.email
    if (!target.socialLink && source.socialLink) updateData.socialLink = source.socialLink

    // Append comment
    if (source.comment) {
      updateData.comment = target.comment
        ? `${target.comment}\n--- Из объединённого клиента ---\n${source.comment}`
        : source.comment
    }

    // 4. Пересчитать агрегаты
    const [subsCount, paymentsSum] = await Promise.all([
      tx.subscription.count({ where: { clientId: targetId, tenantId, deletedAt: null } }),
      tx.payment.aggregate({
        where: { clientId: targetId, tenantId, deletedAt: null },
        _sum: { amount: true },
      }),
    ])

    // Считаем monthsLtv по уникальным месяцам подписок
    const subs = await tx.subscription.findMany({
      where: { clientId: targetId, tenantId, deletedAt: null },
      select: { startDate: true },
    })
    const uniqueMonths = new Set(
      subs.map((s) => `${s.startDate.getFullYear()}-${s.startDate.getMonth()}`)
    )

    // Баланс: сумма балансов
    const newBalance = Number(target.clientBalance) + Number(source.clientBalance)

    await tx.client.update({
      where: { id: targetId },
      data: {
        ...updateData,
        clientBalance: newBalance,
        moneyLtv: Number(paymentsSum._sum.amount || 0),
        monthsLtv: uniqueMonths.size,
        totalSubscriptionsCount: subsCount,
      },
    })

    // 5. Soft-delete source
    await tx.client.update({
      where: { id: sourceId },
      data: { deletedAt: new Date() },
    })

    // 6. Audit log
    await tx.auditLog.create({
      data: {
        tenantId,
        employeeId: session.user.employeeId,
        action: "merge",
        entityType: "Client",
        entityId: targetId,
        changes: {
          mergedFrom: sourceId,
          mergedTo: targetId,
          sourceData: {
            firstName: source.firstName,
            lastName: source.lastName,
            phone: source.phone,
          },
        },
      },
    })

    // 7. Вернуть обновлённого target
    return tx.client.findUnique({
      where: { id: targetId },
      include: {
        wards: true,
        branch: { select: { id: true, name: true } },
      },
    })
  })

  return NextResponse.json(result)
}
