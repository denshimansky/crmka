// ADM-04, сегментная видимость клиентов для админа.
//
// Правила (от продукта):
//   - Лид (funnelStatus до первой оплаты)    → Client.branchId IN scope OR IS NULL
//   - Живой абонемент (pending/active)       → группа абонемента в scope
//   - Активная заявка                        → филиал заявки в scope
//   - Активный клиент без живого абонемента  → Client.branchId IN scope OR IS NULL
//   - Выбывший (clientStatus=churned)        → lastBranchId IN scope; NULL → по Client.branchId (NULL → видят все)
//   - Потенциал (funnelStatus=potential)     → последняя заявка в scope; нет заявок → видят все
//   - Архив (funnelStatus=archived ИЛИ clientStatus=archived) → lastBranchId IN scope OR IS NULL
//   - ЧС (funnelStatus=blacklisted)          → lastBranchId IN scope OR IS NULL
//   - Нецелевой (funnelStatus=non_target)    → видят все
//
// Каждое правило выражается отдельно (segment-condition AND branch-condition),
// и они объединяются OR. Клиент попадает в выборку, если выполнено хотя бы
// одно правило, соответствующее его статусу.

import type { Prisma } from "@prisma/client"
import { isUnscoped, type BranchScope } from "@/lib/branch-scope"

// Воронка для лида (нет оплат): включает все «до-первой-оплаты» статусы.
// Совпадает с тем, как страница /crm/contacts отделяет лидов от клиентов
// (см. crm/contacts/page.tsx:40-49).
const LEAD_FUNNEL_STATUSES = [
  "new",
  "trial_scheduled",
  "trial_attended",
  "awaiting_payment",
] as const

export function scopeClientByBranch(
  scope: BranchScope,
): Prisma.ClientWhereInput {
  if (isUnscoped(scope)) return {}

  const branchIds = scope.branchIds
  const branchIn = { in: branchIds }

  // Если у админа scope ограничен пустым списком филиалов — он не видит
  // никого, кроме нецелевых и тех клиентов, у кого вообще нет привязок.
  // Этой ветки пока в проде нет (пустой EmployeeBranch → null в сессии),
  // но семантика сохранена для будущей deny-политики.
  return {
    OR: [
      // 1. Лид: funnelStatus в LEAD-наборе, видимость по Client.branchId
      //    (NULL → видят все). Требования totalSubscriptionsCount=0 нет
      //    сознательно: лиду на этапе «ожидаем оплату» уже могли выписать
      //    pending-абонемент — он должен остаться видимым админу филиала.
      {
        funnelStatus: { in: LEAD_FUNNEL_STATUSES as unknown as Prisma.EnumFunnelStatusFilter["in"] },
        OR: [{ branchId: branchIn }, { branchId: null }],
      },
      // 2. Живой абонемент: pending или active в группе scope-филиала.
      //    pending включён, потому что «выписан, ждём оплату» — рабочий набор
      //    админа; условия по clientStatus нет — клиент с живым абонементом
      //    в филиале виден его админу при любом статусе.
      {
        subscriptions: {
          some: {
            status: { in: ["pending", "active"] },
            deletedAt: null,
            group: { branchId: branchIn },
          },
        },
      },
      // 3. Активная заявка в scope-филиале: воронка «Продаж» этого филиала —
      //    рабочий набор его админа независимо от статуса родителя. Без этого
      //    правила уже купивший клиент (active_client), который привёл ребёнка
      //    на новое направление, пропадал из «Продаж» у админа филиала: правило 1
      //    требует лидовый funnelStatus, правило 2 — живой абонемент (а у
      //    клиента с разовыми посещениями его нет вовсе). Архив/ЧС исключены:
      //    перевод в архив заявки не закрывает, и зависшая заявка ранних этапов
      //    иначе давала бы вечную видимость в обход правил 7–8.
      {
        funnelStatus: { notIn: ["archived", "blacklisted"] },
        applications: {
          some: { status: "active", deletedAt: null, branchId: branchIn },
        },
      },
      // 4. Активный клиент без живого абонемента (например, ходит на разовые
      //    посещения): якоря «группа абонемента» нет — видимость по
      //    Client.branchId, как у лида (NULL → видят все). Выбывшие сюда не
      //    попадают (clientStatus=churned управляется правилом 5); NULL
      //    допущен, потому что API не гарантирует пару funnelStatus/clientStatus.
      {
        funnelStatus: "active_client",
        subscriptions: {
          none: { status: { in: ["pending", "active"] }, deletedAt: null },
        },
        AND: [
          { OR: [{ clientStatus: "active" }, { clientStatus: null }] },
          { OR: [{ branchId: branchIn }, { branchId: null }] },
        ],
      },
      // 5. Выбывший: lastBranchId в scope. lastBranchId=NULL значит «абонементов
      //    не было» (например, ходил на разовые) — тогда видимость определяет
      //    Client.branchId, а клиент вовсе без филиала виден всем (решение
      //    владельца 14.07.2026: клиент без филиала не должен быть виден только
      //    владельцу).
      {
        clientStatus: "churned",
        OR: [
          { lastBranchId: branchIn },
          {
            AND: [
              { lastBranchId: null },
              { OR: [{ branchId: branchIn }, { branchId: null }] },
            ],
          },
        ],
      },
      // 6. Потенциал: последняя заявка в scope-филиалах.
      //    Application.branchId обязательное, поэтому «нет филиала в заявке»
      //    не бывает; правило «если в заявке не было филиала, то все видят»
      //    переинтерпретировано как «если у клиента нет заявок — видят все».
      {
        funnelStatus: "potential",
        OR: [
          { applications: { some: { branchId: branchIn } } },
          { applications: { none: {} } },
        ],
      },
      // 7. Архив: lastBranchId в scope; NULL → видят все. Архив живёт в
      //    funnelStatus (перевод в архив ставит funnelStatus=archived и
      //    ОБНУЛЯЕТ clientStatus — см. movingToArchived в PATCH /api/clients/[id],
      //    импорт делает так же); clientStatus=archived оставлен для
      //    совместимости — API его допускает.
      {
        AND: [
          { OR: [{ funnelStatus: "archived" }, { clientStatus: "archived" }] },
          { OR: [{ lastBranchId: branchIn }, { lastBranchId: null }] },
        ],
      },
      // 8. Чёрный список: то же правило, что и архив.
      {
        funnelStatus: "blacklisted",
        OR: [{ lastBranchId: branchIn }, { lastBranchId: null }],
      },
      // 9. Нецелевой: видят все, без ограничений по филиалу.
      { funnelStatus: "non_target" },
    ],
  }
}

// Хелпер для целей отладки/тестов: вернуть набор сегментных WHERE отдельно.
// Не используется в проде, экспортируется для unit-тестов.
export function clientSegmentRules(
  scope: BranchScope,
): Prisma.ClientWhereInput[] {
  const combined = scopeClientByBranch(scope)
  if (!combined.OR) return []
  return combined.OR as Prisma.ClientWhereInput[]
}
