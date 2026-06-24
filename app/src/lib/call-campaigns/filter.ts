import type { Prisma } from "@prisma/client"
import { branchScopeFromSession } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"

/**
 * Критерии отбора клиентов в кампанию обзвона (баг #44).
 *
 * Все поля опциональны и комбинируются по И (AND). Источник истины для отбора —
 * используется и при создании кампании (POST /api/call-campaigns), и для
 * предпросмотра количества (GET /api/call-campaigns/preview), чтобы оператор
 * видел размер выборки до создания.
 */
export interface CampaignFilterCriteria {
  /** Этап воронки (Client.funnelStatus или Ward.salesStage для продажных стадий). */
  funnelStatus?: string
  /** Рабочий статус клиента: active | churned | archived | not_active. */
  clientStatus?: string
  /** Сегмент (Client.segment). */
  segment?: string
  /** Филиал: куда ходил (выбывший) или записывался/пробное (потенциальный). */
  branchId?: string
  /** Возраст подопечного, лет — от. */
  minAge?: number
  /** Возраст подопечного, лет — до (включительно). */
  maxAge?: number
  /** Дата выбытия (последнее платное занятие), YYYY-MM-DD — от. */
  withdrawnFrom?: string
  /** Дата выбытия — по (включительно). */
  withdrawnTo?: string
  /** Дата последней связи/коммуникации (Communication.createdAt), YYYY-MM-DD — от. */
  lastContactFrom?: string
  /** Дата последней связи — по (включительно). */
  lastContactTo?: string
  /** Типы открытых автозадач — включить клиентов с такими задачами. */
  autoTriggers?: string[]
}

/** Продажные стадии переехали на Ward.salesStage — фильтруем по подопечным. */
const WARD_STAGES = new Set([
  "application",
  "trial_scheduled",
  "trial_attended",
  "awaiting_payment",
])

/** Вычесть n лет из даты (по UTC, без времени). */
function subYears(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear() - n, d.getUTCMonth(), d.getUTCDate()))
}

function parseDate(s: string | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Строит условие отбора клиентов по критериям. Возвращает Prisma.ClientWhereInput
 * БЕЗ tenantId/deletedAt/scope — их добавляет вызывающий (где есть сессия).
 *
 * Каждый фильтр — отдельный элемент AND (включая фильтры с внутренним OR, чтобы
 * несколько OR-условий не затирали друг друга на верхнем уровне).
 */
export function buildCampaignClientWhere(
  fc: CampaignFilterCriteria,
  now: Date = new Date(),
): Prisma.ClientWhereInput {
  const and: Prisma.ClientWhereInput[] = []

  // --- Этап воронки ---
  // Продажные стадии живут на подопечном (Ward.salesStage), остальные — на клиенте.
  const wardConds: Prisma.WardWhereInput[] = []
  if (fc.funnelStatus) {
    if (WARD_STAGES.has(fc.funnelStatus)) {
      wardConds.push({ salesStage: fc.funnelStatus as never })
    } else {
      and.push({ funnelStatus: fc.funnelStatus as never })
    }
  }

  // --- Возраст подопечного (от/до) ---
  // age >= minAge ⟺ birthDate <= today − minAge лет;
  // age <= maxAge ⟺ birthDate > today − (maxAge+1) лет.
  const hasMin = typeof fc.minAge === "number" && fc.minAge >= 0
  const hasMax = typeof fc.maxAge === "number" && fc.maxAge >= 0
  if (hasMin || hasMax) {
    const birth: Prisma.DateTimeNullableFilter = {}
    if (hasMin) birth.lte = subYears(now, fc.minAge as number)
    if (hasMax) birth.gt = subYears(now, (fc.maxAge as number) + 1)
    wardConds.push({ birthDate: birth })
  }

  // Условия по подопечному применяем к ОДНОМУ ребёнку (этап и возраст вместе).
  if (wardConds.length === 1) {
    and.push({ wards: { some: wardConds[0] } })
  } else if (wardConds.length > 1) {
    and.push({ wards: { some: { AND: wardConds } } })
  }

  // --- Рабочий статус клиента ---
  if (fc.clientStatus === "not_active") {
    and.push({ clientStatus: { in: ["churned", "archived"] } as never })
  } else if (fc.clientStatus) {
    and.push({ clientStatus: fc.clientStatus as never })
  }

  // --- Сегмент ---
  if (fc.segment) and.push({ segment: fc.segment as never })

  // --- Филиал ---
  // Выбывший — куда ходил (branchId/lastBranchId/зачисления);
  // потенциальный — куда записывался/пробное (через группу или кабинет пробного).
  if (fc.branchId) {
    const branchId = fc.branchId
    and.push({
      OR: [
        { branchId },
        { lastBranchId: branchId },
        { enrollments: { some: { deletedAt: null, group: { branchId } } } },
        {
          trialLessons: {
            some: { OR: [{ group: { branchId } }, { room: { branchId } }] },
          },
        },
      ],
    })
  }

  // --- Дата выбытия (от/до) ---
  // Канонический сигнал «перестал ходить» — Subscription.withdrawalDate (дата
  // последнего платного занятия), как во всех отчётах оттока. Дополнительно
  // ловим Client.withdrawalDate (его ставит крон 30-дневной неактивности).
  const wFrom = parseDate(fc.withdrawnFrom)
  const wTo = parseDate(fc.withdrawnTo)
  if (wFrom || wTo) {
    const range: Prisma.DateTimeNullableFilter = {}
    if (wFrom) range.gte = wFrom
    if (wTo) range.lte = wTo // withdrawalDate — @db.Date, сравнение по дню
    and.push({
      OR: [
        { subscriptions: { some: { deletedAt: null, withdrawalDate: range } } },
        { withdrawalDate: range },
      ],
    })
  }

  // --- Дата ПОСЛЕДНЕЙ связи/коммуникации (от/до) ---
  // Нужна семантика «последний контакт в диапазоне», а не «была какая-то».
  // last >= From  ⟺  есть коммуникация >= From (some gte).
  // last <= To    ⟺  нет коммуникаций позже To (none gt) И хотя бы одна есть (some).
  const cFrom = parseDate(fc.lastContactFrom)
  if (cFrom) {
    and.push({ communications: { some: { createdAt: { gte: cFrom } } } })
  }
  if (parseDate(fc.lastContactTo)) {
    // createdAt — полный таймстамп, поэтому «по» включаем до конца дня.
    const cTo = new Date(`${fc.lastContactTo}T23:59:59.999Z`)
    and.push({ communications: { none: { createdAt: { gt: cTo } } } })
    // Гарантируем, что коммуникации вообще есть (иначе none тривиально истинно
    // и сюда попадут клиенты без единого контакта). Если задан и «от» — это уже
    // обеспечено условием some выше.
    if (!cFrom) and.push({ communications: { some: {} } })
  }

  // --- Открытые автозадачи выбранных типов ---
  if (fc.autoTriggers && fc.autoTriggers.length > 0) {
    and.push({
      tasks: {
        some: {
          autoTrigger: { in: fc.autoTriggers as never },
          status: "pending",
          deletedAt: null,
        },
      },
    })
  }

  return and.length > 0 ? { AND: and } : {}
}

/**
 * Финальное условие отбора с tenant + soft-delete + scope по филиалам сессии.
 * Единая точка для создания кампании и предпросмотра количества.
 */
export function buildScopedCampaignWhere(
  tenantId: string,
  allowedBranchIds: string[] | null,
  fc: CampaignFilterCriteria,
  now: Date = new Date(),
): Prisma.ClientWhereInput {
  const scope = branchScopeFromSession(allowedBranchIds)
  return {
    AND: [
      { tenantId, deletedAt: null },
      scopeClientByBranch(scope),
      buildCampaignClientWhere(fc, now),
    ],
  }
}
