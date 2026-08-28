import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/api-permissions"
import { db } from "@/lib/db"
import { previewBulkRenew, applyBulkRenew } from "@/lib/subscriptions/bulk-renew"

// POST /api/subscriptions/[id]/renew — точечное продление одного абонемента
// на следующий период. Используется из карточки клиента (кнопка «+ Абонемент»).
//
// Параметры (group, direction, ward) копируются из исходного абонемента, цена —
// актуальный прайс направления (см. bulk-renew.ts); период — следующий
// календарный месяц.
//
// Источник — действующий ИЛИ штатно закрытый абонемент (автозакрытие идёт
// ежедневно с 1-го числа: полностью отхоженный и оплаченный месяц уже closed,
// но продление с него легитимно). Отчисленный (withdrawn) не продлевается —
// ребёнок ушёл. Если источника нет, эндпойнт возвращает 404 — в этом случае
// нужно заводить заявку для нового направления/группы.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Тот же гейт, что у массовой выписки: продление — это создание абонемента.
  const guard = await requirePermission("subscriptions.edit")
  if (!guard.ok) return guard.response
  const user = guard.session!.user as {
    role: string
    tenantId: string
    employeeId: string | null
    allowedBranchIds: string[] | null
  }

  const { id } = await params
  const tenantId = user.tenantId
  // ADM-04: админ с привязкой к филиалам продлевает только «свои» абонементы.
  const allowedBranchIds = user.allowedBranchIds ?? null

  const source = await db.subscription.findFirst({
    where: {
      id,
      tenantId,
      deletedAt: null,
      type: "calendar",
      status: { in: ["active", "closed"] },
      // Симметрично массовой выписке: удалённому клиенту не продлеваем
      // (удаление клиента не помечает его абонементы deletedAt).
      client: { deletedAt: null },
    },
    select: {
      id: true,
      clientId: true,
      periodYear: true,
      periodMonth: true,
      group: { select: { branchId: true } },
      client: { select: { funnelStatus: true } },
    },
  })
  if (!source) {
    return NextResponse.json(
      { error: "Календарный абонемент для продления не найден (отчисленные не продлеваются). Заведите заявку для нового направления/группы." },
      { status: 404 },
    )
  }
  if (allowedBranchIds && !allowedBranchIds.includes(source.group.branchId)) {
    return NextResponse.json(
      { error: "Абонемент относится к другому филиалу — продление недоступно." },
      { status: 403 },
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
  const nextMonthIdx = baseMonth + 1 // 1..12 → следующий 2..13
  const targetYear = nextMonthIdx > 12 ? baseYear + 1 : baseYear
  const targetMonth = nextMonthIdx > 12 ? 1 : nextMonthIdx

  // Целевой месяц не в прошлом: у closed-источника ограничение «за прошлый
  // месяц» в loadSources для точечного продления тавтологично (диапазон
  // строится от периода самого источника), поэтому древний closed без этого
  // guard'а молча выписал бы абонемент на давно прошедший месяц (полный долг +
  // ретро-возврат ребёнка в старые составы). Заодно закрывает и «застрявший»
  // active старого месяца. Легитимные случаи проходят: active текущего →
  // следующий месяц; closed прошлого → текущий.
  const nowLocal = new Date()
  if (targetYear * 100 + targetMonth < nowLocal.getFullYear() * 100 + (nowLocal.getMonth() + 1)) {
    return NextResponse.json(
      { error: "Период продления уже прошёл — продлить можно действующий или закрытый за прошлый месяц абонемент." },
      { status: 409 },
    )
  }

  // Локальная полночь — контракт bulk-renew (как parseDay в массовом роуте):
  // prevMonthOfRange/periodYear/periodMonth читают локальные геттеры, UTC-даты
  // на TZ западнее UTC смещали бы месяц источника и период абонемента.
  const rangeStart = new Date(targetYear, targetMonth - 1, 1)
  const rangeEnd = new Date(targetYear, targetMonth, 0)

  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean }

  const opts = {
    tenantId,
    rangeStart,
    rangeEnd,
    subscriptionId: source.id,
    // Второй рубеж: даже если проверка выше кем-то обойдена, loadSources не
    // возьмёт источник из чужого филиала.
    allowedBranchIds,
    createdBy: user.employeeId ?? null,
  }

  if (body.dryRun) {
    const preview = await previewBulkRenew(opts)
    return NextResponse.json(preview)
  }

  const result = await applyBulkRenew(opts)
  return NextResponse.json(result, { status: 201 })
}
