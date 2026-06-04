import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { db } from "@/lib/db"
import { previewBulkRenew, applyBulkRenew } from "@/lib/subscriptions/bulk-renew"

// POST /api/subscriptions/[id]/renew — точечное продление одного абонемента
// на следующий период. Используется из карточки клиента (кнопка «+ Абонемент»).
//
// Параметры (group, direction, ward, price) копируются из исходного абонемента;
// меняется только период (по умолчанию — следующий календарный месяц).
//
// Если у клиента нет действующего абонемента (источника), эндпойнт возвращает 404 —
// в этом случае нужно заводить заявку для нового направления/группы.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const tenantId = session.user.tenantId

  const source = await db.subscription.findFirst({
    where: { id, tenantId, deletedAt: null, type: "calendar", status: "active" },
    select: {
      id: true,
      clientId: true,
      periodYear: true,
      periodMonth: true,
      client: { select: { funnelStatus: true } },
    },
  })
  if (!source) {
    return NextResponse.json(
      { error: "Действующий календарный абонемент не найден. Заведите заявку для нового направления/группы." },
      { status: 404 },
    )
  }
  if (
    source.client.funnelStatus === "archived" ||
    source.client.funnelStatus === "blacklisted"
  ) {
    return NextResponse.json(
      { error: "Клиент в архиве/ЧС — снимите статус, чтобы выписать абонемент." },
      { status: 403 },
    )
  }

  // Период следующего за текущим месяца. Берём из source.periodYear/Month,
  // если они есть; иначе — следующий после today.
  const baseYear = source.periodYear ?? new Date().getFullYear()
  const baseMonth = source.periodMonth ?? new Date().getMonth() + 1
  const nextMonthIdx = baseMonth // 1..12 → следующий 2..13
  const targetYear = nextMonthIdx > 12 ? baseYear + 1 : baseYear
  const targetMonth = nextMonthIdx > 12 ? 1 : nextMonthIdx

  const rangeStart = new Date(Date.UTC(targetYear, targetMonth - 1, 1))
  const rangeEnd = new Date(Date.UTC(targetYear, targetMonth, 0))

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean }

  const opts = {
    tenantId,
    rangeStart,
    rangeEnd,
    subscriptionId: source.id,
    createdBy: session.user.employeeId ?? null,
  }

  if (body.dryRun) {
    const preview = await previewBulkRenew(opts)
    return NextResponse.json(preview)
  }

  const result = await applyBulkRenew(opts)
  return NextResponse.json(result, { status: 201 })
}
