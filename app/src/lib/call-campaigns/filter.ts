import type { Prisma, TaskAutoTrigger } from "@prisma/client"
import { z } from "zod"
import { branchScopeFromSession } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"
import { MANAGED_TRIGGERS } from "@/lib/tasks/trigger-settings"

/**
 * Критерии отбора клиентов в кампанию обзвона (баг #44).
 *
 * Все поля опциональны и комбинируются по И (AND). Источник истины для отбора —
 * используется и при создании кампании (POST /api/call-campaigns), и для
 * предпросмотра количества (POST /api/call-campaigns/preview), чтобы оператор
 * видел размер выборки до создания.
 *
 * Два режима кампании:
 *  - «Обзвон по базам» (mode отсутствует или "base") — отбор по фильтрам базы;
 *  - «Обзвон по задачам» (mode="tasks") — только autoTriggers, поиск по всей
 *    базе, кроме архива, чёрного списка и нецелевых.
 */
export interface CampaignFilterCriteria {
  /** Режим кампании: по базам (дефолт) или по автозадачам. */
  mode?: "base" | "tasks"
  /**
   * Этап воронки — вкладки раздела «Продажи»: application | trial_scheduled |
   * trial_attended | awaiting_payment (по активной заявке) | contact
   * (назначена дата следующей связи).
   */
  funnelStatus?: string
  /**
   * Статус клиента (единый селект модалки): leads | active | churned |
   * potential | contact (назначена дата следующей связи — перенесён из
   * «Этапа воронки»). archived | blacklist | nontarget больше не выбираются
   * из UI, но остаются валидными для актуализации старых кампаний (legacy).
   */
  clientStatus?: string
  /** Филиал: куда ходил (выбывший) или записывался/пробное (потенциальный). */
  branchId?: string
  /**
   * «Без филиала»: клиенты, у которых филиал на карточке не проставлен
   * (branchId/lastBranchId/prevBranchId — все NULL). Взаимоисключающе с branchId
   * (в UI — один селект). Баг #113.
   */
  noBranch?: boolean
  /** Дата рождения подопечного, YYYY-MM-DD — от (ранняя граница, включительно). */
  birthFrom?: string
  /** Дата рождения подопечного, YYYY-MM-DD — по (поздняя граница, включительно). */
  birthTo?: string
  /** @deprecated legacy: возраст подопечного, лет — от. Заменён на birthFrom. */
  minAge?: number
  /** @deprecated legacy: возраст подопечного, лет — до. Заменён на birthTo. */
  maxAge?: number
  /** Дата выбытия (последнее платное занятие), YYYY-MM-DD — от. */
  withdrawnFrom?: string
  /** Дата выбытия — по (включительно). */
  withdrawnTo?: string
  /** Дата следующей связи (Client.nextContactDate), YYYY-MM-DD — от. */
  nextContactFrom?: string
  /** Дата следующей связи — по (включительно). */
  nextContactTo?: string
  /** Типы открытых автозадач — включить клиентов с такими задачами. */
  autoTriggers?: string[]
}

/**
 * Общая zod-схема критериев — для create и preview (единая валидация).
 * Значения строго перечислены: свободная строка провалилась бы через `as never`
 * до Prisma-enum и уронила бы роут 500-кой вместо 400 (PrismaClientValidationError).
 */
export const campaignFilterSchema = z.object({
  mode: z.enum(["base", "tasks"]).optional(),
  funnelStatus: z.enum([
    "application", "trial_scheduled", "trial_attended", "awaiting_payment", "contact",
    // legacy-значения старых кампаний (валидные Client.funnelStatus)
    "new", "active_client", "potential",
  ]).optional(),
  clientStatus: z.enum([
    "leads", "active", "churned", "potential", "contact",
    "archived", "blacklist", "nontarget",
    // legacy-значение старых кампаний
    "not_active",
  ]).optional(),
  branchId: z.string().optional(),
  noBranch: z.boolean().optional(),
  birthFrom: z.string().optional(),
  birthTo: z.string().optional(),
  // legacy старых кампаний — оставлены валидными для «Актуализировать».
  minAge: z.number().int().min(0).max(120).optional(),
  maxAge: z.number().int().min(0).max(120).optional(),
  withdrawnFrom: z.string().optional(),
  withdrawnTo: z.string().optional(),
  nextContactFrom: z.string().optional(),
  nextContactTo: z.string().optional(),
  autoTriggers: z
    .array(z.enum(MANAGED_TRIGGERS as [TaskAutoTrigger, ...TaskAutoTrigger[]]))
    .optional(),
})

/** Этапы воронки «Продаж» — фильтруем по активной заявке на этапе (вкладка = этап). */
const APPLICATION_STAGES = new Set([
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

  // --- Режим «Обзвон по задачам» ---
  // Только открытые автозадачи выбранных типов (блок autoTriggers ниже),
  // поиск по всей базе, кроме архива, чёрного списка и нецелевых. Остальные
  // фильтры UI в этом режиме не отправляет.
  if (fc.mode === "tasks") {
    and.push({ funnelStatus: { notIn: ["archived", "blacklisted", "non_target"] } })
    // Без выбранных типов выборка пуста — защита от «обзвона всей базы».
    if (!fc.autoTriggers || fc.autoTriggers.length === 0) {
      and.push({ id: { in: [] } })
    }
  }

  // --- База: не звоним в архив / чёрный список / нецелевых ---
  // Эти статусы убраны из селектора «Статус клиента» (обзвон по базам их больше
  // не таргетирует). Глобально исключаем их из ЛЮБОЙ base-выборки: «Все»,
  // «Связь», а также фильтры только по возрасту/филиалу/дате. Пропускаем только
  // когда старая кампания явно выбрала один из этих терминальных статусов
  // (legacy-значения ниже), чтобы её актуализация не превратилась в пустую.
  const TERMINAL_CLIENT_STATUSES = new Set(["archived", "blacklist", "nontarget", "not_active"])
  if (fc.mode !== "tasks" && !TERMINAL_CLIENT_STATUSES.has(fc.clientStatus ?? "")) {
    and.push({ funnelStatus: { notIn: ["archived", "blacklisted", "non_target"] } })
    // «Архив» может жить и в clientStatus (наследие импорта: clientStatus="archived"
    // при неархивном funnelStatus — именно поэтому case "archived" ниже ловит оба
    // поля). Исключаем и его, но СОХРАНЯЯ клиентов с clientStatus=NULL: иначе
    // трёхзначная логика SQL (NULL <> 'archived' = NULL) выкинула бы почти всех.
    and.push({ OR: [{ clientStatus: null }, { clientStatus: { not: "archived" } }] })
  }

  // --- Дата рождения подопечного (от/до) ---
  // Новый фильтр — прямой диапазон даты рождения (birthFrom/birthTo, включительно
  // по дню; birthDate — @db.Date). Legacy-кампании хранят возраст (minAge/maxAge) —
  // конвертируем его в тот же диапазон birthDate ради обратной совместимости
  // «Актуализировать»:
  //   age >= minAge ⟺ birthDate <= today − minAge лет;
  //   age <= maxAge ⟺ birthDate > today − (maxAge+1) лет.
  let birth: Prisma.DateTimeNullableFilter | null = null
  const bFrom = parseDate(fc.birthFrom)
  const bTo = parseDate(fc.birthTo)
  if (bFrom || bTo) {
    birth = {}
    if (bFrom) birth.gte = bFrom
    if (bTo) birth.lte = bTo
  } else {
    const hasMin = typeof fc.minAge === "number" && fc.minAge >= 0
    const hasMax = typeof fc.maxAge === "number" && fc.maxAge >= 0
    if (hasMin || hasMax) {
      birth = {}
      if (hasMin) birth.lte = subYears(now, fc.minAge as number)
      if (hasMax) birth.gt = subYears(now, (fc.maxAge as number) + 1)
    }
  }

  // --- Этап воронки (= вкладки раздела «Продажи») ---
  // Этапы заявки — по активной заявке (воронка ведётся по Application.stage,
  // как вкладки «Продаж»); возраст, если задан, применяем к подопечному ТОЙ ЖЕ
  // заявки. «Связь» — назначена дата следующей связи (как вкладка «Связь»).
  // Все вкладки «Продаж» исключают архив/ЧС (notArchivedClient в sales/page.tsx)
  // — повторяем: архивация НЕ очищает nextContactDate, а зависшие active-заявки
  // терминальных клиентов на проде известны; без исключения кампания звонила бы
  // в чёрный список. Прочие значения (legacy-кампании: new/active_client/
  // potential) — по Client.funnelStatus, как раньше.
  const notArchived: Prisma.ClientWhereInput["funnelStatus"] = {
    notIn: ["archived", "blacklisted"],
  }
  let ageConsumed = false
  if (fc.funnelStatus) {
    if (APPLICATION_STAGES.has(fc.funnelStatus)) {
      and.push({
        funnelStatus: notArchived,
        applications: {
          some: {
            status: "active",
            deletedAt: null,
            stage: fc.funnelStatus as never,
            ...(birth ? { ward: { birthDate: birth } } : {}),
          },
        },
      })
      ageConsumed = true
    } else if (fc.funnelStatus === "contact") {
      and.push({ funnelStatus: notArchived, nextContactDate: { not: null } })
    } else {
      and.push({ funnelStatus: fc.funnelStatus as never })
    }
  }
  if (birth && !ageConsumed) {
    and.push({ wards: { some: { birthDate: birth } } })
  }

  // --- Статус клиента (= вкладки раздела «Клиенты») ---
  // Зеркалит buildWhere вкладок /crm/contacts: лиды / активные / выбывшие /
  // потенциал / архив / чёрный список / нецелевой. «Архив» живёт в
  // funnelStatus: перевод в архив ставит funnelStatus=archived и ОБНУЛЯЕТ
  // clientStatus, поэтому дополнительно ловим clientStatus='archived'
  // (наследие импорта). Legacy-значение not_active (старые кампании)
  // продолжает работать.
  const archivedOr: Prisma.ClientWhereInput[] = [
    { funnelStatus: "archived" },
    { clientStatus: "archived" },
  ]
  switch (fc.clientStatus || "") {
    case "":
      break
    case "leads":
      and.push({ funnelStatus: "new", payments: { none: {} } })
      break
    case "active":
      and.push({ clientStatus: "active", funnelStatus: { notIn: ["archived", "blacklisted"] } })
      break
    case "churned":
      and.push({ clientStatus: "churned", funnelStatus: { notIn: ["archived", "blacklisted"] } })
      break
    case "potential":
      and.push({
        funnelStatus: "potential",
        applications: { none: { status: "active", deletedAt: null } },
      })
      break
    case "contact":
      // «Связь» — назначена дата следующей связи (пункт перенесён из «Этапа
      // воронки» в «Статус клиента»). Архив (и в funnelStatus, и в clientStatus),
      // ЧС и нецелевые уже отсечены глобальным base-исключением выше — здесь
      // только наличие даты.
      and.push({ nextContactDate: { not: null } })
      break
    case "archived":
      and.push({ OR: archivedOr })
      break
    case "blacklist":
      and.push({ funnelStatus: "blacklisted" })
      break
    case "nontarget":
      and.push({ funnelStatus: "non_target" })
      break
    case "not_active":
      and.push({ OR: [{ clientStatus: "churned" }, ...archivedOr] })
      break
    // default недостижим: значения ограничены campaignFilterSchema (z.enum).
  }

  // --- Филиал ---
  // Выбывший — куда ходил (branchId/lastBranchId/зачисления);
  // потенциальный — куда записывался/пробное (через группу или кабинет пробного);
  // лид с заявкой — филиал активной заявки (фильтр «Продаж» единый по заявке,
  // решение владельца 14.07.2026; Client.branchId у свежего лида часто NULL).
  if (fc.branchId) {
    const branchId = fc.branchId
    and.push({
      OR: [
        { branchId },
        // Баг #79 — два последних РАЗНЫХ филиала абонементов (мультифилиальность).
        { lastBranchId: branchId },
        { prevBranchId: branchId },
        { applications: { some: { status: "active", deletedAt: null, branchId } } },
        { enrollments: { some: { deletedAt: null, group: { branchId } } } },
        {
          trialLessons: {
            some: { OR: [{ group: { branchId } }, { room: { branchId } }] },
          },
        },
      ],
    })
  }

  // --- Без филиала (баг #113) ---
  // Клиент, у которого филиал не проставлен на карточке: branchId, lastBranchId и
  // prevBranchId — все NULL. Именно эти три поля показывает столбец «Филиал» в
  // списках; производный филиал (по заявкам/зачислениям/пробным) здесь не
  // учитываем — «филиал не указан» означает пустое поле филиала клиента. В UI
  // взаимоисключающе с выбором конкретного филиала (один селект).
  if (fc.noBranch) {
    and.push({ branchId: null, lastBranchId: null, prevBranchId: null })
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

  // --- Дата следующей связи (от/до) ---
  // Client.nextContactDate — @db.Date, диапазон включительно по дню. Сравнение
  // с NULL в Prisma не матчится, поэтому «дата назначена» гарантируется само.
  const ncFrom = parseDate(fc.nextContactFrom)
  const ncTo = parseDate(fc.nextContactTo)
  if (ncFrom || ncTo) {
    const range: Prisma.DateTimeNullableFilter = {}
    if (ncFrom) range.gte = ncFrom
    if (ncTo) range.lte = ncTo
    and.push({ nextContactDate: range })
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
