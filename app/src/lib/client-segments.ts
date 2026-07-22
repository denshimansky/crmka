// ADM-04 + баг #79: сегментная видимость клиентов для админа филиала.
//
// МОДЕЛЬ ФИЛИАЛОВ КЛИЕНТА (баг #79 — мультифилиальность):
//   Клиент «находится» в филиалах = {lastBranchId, prevBranchId}  (два последних
//   РАЗНЫХ филиала выписанных абонементов, см. lib/subscriptions/client-branches.ts)
//   ∪ {филиалы, где есть ЖИВОЙ (pending/active) абонемент}.
//   Админ филиала видит клиента, если его филиал попадает в это множество.
//   Для клиентов БЕЗ истории абонементов (оба поля NULL) действует старый
//   фолбэк по «домашнему» Client.branchId / заявке — по сегментам.
//
// Правила (от продукта):
//   - Лид (до первой оплаты)                 → Client.branchId IN scope OR IS NULL
//   - Живой абонемент (pending/active)        → группа абонемента в scope (ВСЕ живые)
//   - Активная заявка                         → филиал заявки в scope
//   - Два последних РАЗНЫХ филиала абонементов → lastBranchId ИЛИ prevBranchId в scope
//                                               (безусловно по сегменту — баг #79)
//   - Активный клиент без истории абонементов → Client.branchId IN scope OR IS NULL
//   - Выбывший без истории                    → Client.branchId IN scope OR IS NULL
//   - Потенциал                               → последняя заявка в scope; нет заявок → все
//   - Архив без истории                       → видят все
//   - ЧС без истории                          → видят все
//   - Нецелевой                               → видят все
//
// Каждое правило — отдельный (segment AND branch) фрагмент, объединяются через OR.
// Клиент в выборке, если выполнено хотя бы одно правило под его статус.

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

  // Клиент без истории абонементов: оба денормализованных филиала пусты.
  const noBranchHistory: Prisma.ClientWhereInput = {
    lastBranchId: null,
    prevBranchId: null,
  }
  // Фолбэк по «домашнему» филиалу: в scope ИЛИ вовсе без филиала (виден всем).
  const branchIdInOrNull: Prisma.ClientWhereInput = {
    OR: [{ branchId: branchIn }, { branchId: null }],
  }

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
        ...branchIdInOrNull,
      },
      // 2. Живой абонемент: pending или active в группе scope-филиала. Показывает
      //    клиента во ВСЕХ филиалах, где он реально занимается сейчас (баг #79,
      //    решение «2 последних + все живые»): трое детей в трёх филиалах — виден
      //    админам всех трёх. Условия по clientStatus нет — клиент с живым
      //    абонементом в филиале виден его админу при любом статусе.
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
      //    иначе давала бы вечную видимость в обход правил архива/ЧС.
      {
        funnelStatus: { notIn: ["archived", "blacklisted"] },
        applications: {
          some: { status: "active", deletedAt: null, branchId: branchIn },
        },
      },
      // 4. Баг #79 — два последних РАЗНЫХ филиала абонементов. Безусловно по
      //    сегменту: любой клиент с историей абонементов виден админам обоих
      //    своих филиалов (last/prev), даже если сейчас там нет живого
      //    абонемента (выбывший/архив/ЧС/между периодами) и даже если живой
      //    абонемент есть в третьем филиале. lastBranchId/prevBranchId
      //    проставлены только у клиентов с абонементами — лиды/потенциал их не
      //    имеют, поэтому переэкспозиции нет. Заменяет прежний одиночный якорь
      //    lastBranchId в правилах выбывший/архив/ЧС и branchId в «активный».
      {
        OR: [{ lastBranchId: branchIn }, { prevBranchId: branchIn }],
      },
      // 5. Активный клиент БЕЗ истории абонементов (например, только разовые
      //    посещения): якоря по абонементам нет — видимость по Client.branchId
      //    (NULL → видят все). Выбывшими управляет правило 6; NULL clientStatus
      //    допущен, т.к. API не гарантирует пару funnelStatus/clientStatus.
      {
        funnelStatus: "active_client",
        ...noBranchHistory,
        AND: [
          { OR: [{ clientStatus: "active" }, { clientStatus: null }] },
          branchIdInOrNull,
        ],
      },
      // 6. Выбывший БЕЗ истории абонементов: фолбэк на Client.branchId (NULL →
      //    видят все, решение владельца 14.07.2026 — выбывший без филиала не
      //    должен быть виден только владельцу).
      {
        clientStatus: "churned",
        ...noBranchHistory,
        ...branchIdInOrNull,
      },
      // 7. Потенциал: последняя заявка в scope-филиалах. Application.branchId
      //    обязательное, поэтому «нет филиала в заявке» не бывает; правило «если
      //    в заявке не было филиала — видят все» переинтерпретировано как «если
      //    у клиента нет заявок — видят все».
      {
        funnelStatus: "potential",
        OR: [
          { applications: { some: { branchId: branchIn } } },
          { applications: { none: {} } },
        ],
      },
      // 8. Архив БЕЗ истории абонементов → видят все. Архив живёт в funnelStatus
      //    (перевод в архив ставит funnelStatus=archived и ОБНУЛЯЕТ clientStatus —
      //    см. movingToArchived в PATCH /api/clients/[id], импорт делает так же);
      //    clientStatus=archived оставлен для совместимости. Архив С историей
      //    покрыт правилом 4 (виден только «своим» филиалам).
      {
        AND: [
          { OR: [{ funnelStatus: "archived" }, { clientStatus: "archived" }] },
          noBranchHistory,
        ],
      },
      // 9. Чёрный список БЕЗ истории абонементов → видят все. ЧС С историей —
      //    правило 4.
      {
        funnelStatus: "blacklisted",
        ...noBranchHistory,
      },
      // 10. Нецелевой: видят все, без ограничений по филиалу.
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
