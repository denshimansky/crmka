import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const maxDuration = 120

// POST /api/cron/check-inactive-clients
//
// Раз в сутки (GitHub Actions cron) находит активных клиентов всех тенантов,
// у которых нет активных абонементов уже 30+ дней, и переводит в clientStatus=churned.
//
// «30 дней» отсчитываем от max(withdrawalDate, endDate, startDate) последнего
// абонемента клиента. Если последний абонемент закончился >= 30 дней назад
// и сейчас нет активных — клиент уходит в «Выбывшие».
//
// Авторизация: header Authorization: Bearer ${CRON_SECRET}.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET не сконфигурирован" }, { status: 500 })
  }
  const auth = req.headers.get("authorization") || ""
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Обратная сторона инварианта (Баг #5): «Выбывший» с активным абонементом —
  // всегда рассинхрон. Вручную так сделать нельзя (PATCH клиента запрещает
  // churned при активных абонементах); возникает, когда клиента выбыли при
  // pending-абонементах, а повторная оплата/активация не возвращала статус.
  // Возвращаем таких в активные.
  const reactivated = await db.client.updateMany({
    where: {
      deletedAt: null,
      clientStatus: "churned",
      subscriptions: { some: { status: "active", deletedAt: null } },
    },
    data: { clientStatus: "active", withdrawalDate: null },
  })

  const thresholdDays = 30
  const threshold = new Date()
  threshold.setDate(threshold.getDate() - thresholdDays)

  // Кандидаты: активные клиенты без активных абонементов.
  // Архив/ЧС/уже churned не трогаем.
  const candidates = await db.client.findMany({
    where: {
      deletedAt: null,
      clientStatus: "active",
      subscriptions: { none: { status: "active", deletedAt: null } },
    },
    select: {
      id: true,
      tenantId: true,
      subscriptions: {
        where: { deletedAt: null },
        orderBy: { startDate: "desc" },
        take: 5,
        select: {
          startDate: true,
          endDate: true,
          withdrawalDate: true,
        },
      },
    },
  })

  const toChurn: string[] = []
  for (const c of candidates) {
    if (c.subscriptions.length === 0) {
      // нет ни одного абонемента вообще — не трогаем, может быть лид-импорт
      continue
    }
    const lastDate = c.subscriptions.reduce<Date | null>((acc, s) => {
      const dates = [s.withdrawalDate, s.endDate, s.startDate].filter(
        (d): d is Date => d instanceof Date,
      )
      if (dates.length === 0) return acc
      const maxOfSub = new Date(Math.max(...dates.map((d) => d.getTime())))
      if (!acc || maxOfSub > acc) return maxOfSub
      return acc
    }, null)
    if (!lastDate) continue
    if (lastDate <= threshold) toChurn.push(c.id)
  }

  if (toChurn.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: candidates.length,
      churned: 0,
      reactivated: reactivated.count,
    })
  }

  await db.client.updateMany({
    where: { id: { in: toChurn } },
    data: {
      clientStatus: "churned",
      withdrawalDate: new Date(),
    },
  })

  return NextResponse.json({
    ok: true,
    checked: candidates.length,
    churned: toChurn.length,
    reactivated: reactivated.count,
    thresholdDays,
  })
}
