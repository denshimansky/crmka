// ADM-04, сегментная видимость клиентов для админа.
//
// Правила (от продукта):
//   - Лид (funnelStatus до первой оплаты)    → Client.branchId IN scope OR IS NULL
//   - Живой абонемент (pending/active)       → группа абонемента в scope
//   - Выбывший (clientStatus=churned)        → Client.lastBranchId IN scope
//   - Потенциал (funnelStatus=potential)     → последняя заявка в scope; нет заявок → видят все
//   - Архив (clientStatus=archived)          → lastBranchId IN scope OR IS NULL
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
      // 3. Выбывший: lastBranchId в scope. Если lastBranchId=NULL — этот
      //    OR-вариант не сработает, и клиент попадёт под другое правило
      //    (например, по Client.branchId как «лид» — если у него история
      //    воронки не успела закрыться) или не попадёт вовсе.
      {
        clientStatus: "churned",
        lastBranchId: branchIn,
      },
      // 4. Потенциал: последняя заявка в scope-филиалах.
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
      // 5. Архив: lastBranchId в scope; NULL → видят все.
      {
        clientStatus: "archived",
        OR: [{ lastBranchId: branchIn }, { lastBranchId: null }],
      },
      // 6. Чёрный список: то же правило, что и архив.
      {
        funnelStatus: "blacklisted",
        OR: [{ lastBranchId: branchIn }, { lastBranchId: null }],
      },
      // 7. Нецелевой: видят все, без ограничений по филиалу.
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
