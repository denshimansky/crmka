// Выборка вкладок страницы «Клиенты» (/crm/contacts) — ОДИН источник правды для
// самой страницы и для owner-выгрузки в Excel (/api/clients/contacts-export).
//
// Раньше вся эта логика жила прямо в page.tsx. Как только выгрузку понадобилось
// отдавать отдельным эндпоинтом (гейт «только владелец» должен быть на сервере,
// а не только скрытой кнопкой), правило «кто попадает во вкладку» обязано было
// стать общим: иначе файл и экран разошлись бы при первой же правке предиката —
// а расходятся они молча, что для выгрузки клиентской базы худший вид бага.

import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { maskPhone } from "@/lib/permissions/phone-visibility"
import { scopeClientByBranch, clientInBranch } from "@/lib/client-segments"
import type { BranchScope } from "@/lib/branch-scope"
import {
  computeSegment,
  effectiveSegment,
  monthsSince,
  parseSegmentationConfig,
  type ClientSegmentKey,
} from "@/lib/segmentation"
import type { ContactRow, ContactsTabKey } from "@/app/(dashboard)/crm/contacts/contacts-table"

export const TAB_LABELS: Record<ContactsTabKey, string> = {
  leads: "Лиды",
  potential: "Потенциал",
  nontarget: "Нецелевой",
  active: "Активные",
  churned: "Выбывшие",
  archived: "Архив",
  blacklist: "Чёрный список",
  all: "Все",
}

export const TAB_ORDER: ContactsTabKey[] = [
  "leads",
  "active",
  "churned",
  "potential",
  "archived",
  "blacklist",
  "nontarget",
  "all",
]

export function parseTab(raw: string | undefined | null): ContactsTabKey {
  return TAB_ORDER.includes(raw as ContactsTabKey) ? (raw as ContactsTabKey) : "leads"
}

// Приоритет «продвинутости» — наибольший индекс выигрывает. Используется,
// чтобы показать в баже строки контактов самую продвинутую стадию воронки
// среди подопечных. none не отображаем.
const SALES_STAGE_ORDER = [
  "none",
  "application",
  "trial_scheduled",
  "trial_attended",
  "awaiting_payment",
] as const

function pickTopSalesStage(
  stages: ReadonlyArray<string>,
): ContactRow["topSalesStage"] {
  let top: (typeof SALES_STAGE_ORDER)[number] = "none"
  for (const s of stages) {
    const idx = SALES_STAGE_ORDER.indexOf(s as (typeof SALES_STAGE_ORDER)[number])
    if (idx > SALES_STAGE_ORDER.indexOf(top)) {
      top = SALES_STAGE_ORDER[idx]
    }
  }
  return top === "none" ? null : (top as NonNullable<ContactRow["topSalesStage"]>)
}

// Фильтр по филиалу (модель Анны, 13.08.2026): клиент принадлежит филиалу по
// ручным полям карточки (branchId/secondBranchId) ИЛИ по живому абонементу —
// единое правило clientInBranch (то же, что видимость админа scopeClientByBranch).
function branchColumnWhere(branchId: string): Prisma.ClientWhereInput {
  return clientInBranch([branchId])
}

export function buildWhere(
  tab: ContactsTabKey,
  tenantId: string,
  scope: BranchScope,
  branchFilter: string | null,
): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = { tenantId, deletedAt: null }
  if (tab === "leads") {
    // Лиды: новые. Клиенты с активной заявкой остаются в списке лидов с баджем
    // «Заявка» — менеджеру важно видеть их в общей воронке.
    //
    // Раньше отсекали по «есть любой платёж» (payments none). Но пополнение
    // баланса конверсией НЕ считается (project_active_conversion_rule): лид,
    // пополнивший баланс без абонемента, выпадал из «Лидов» и, не имея
    // clientStatus='active', пропадал из ВСЕХ вкладок (виден только во «Все»).
    // Так «оседают» импортированные базы, где балансы залиты как пополнения.
    //
    // Предикат СТРОГО АДДИТИВНЫЙ: старое условие (нет платежей) ИЛИ «нет живого
    // абонемента и нет платного занятия». Второе плечо возвращает балансовых
    // лидов; первое — сохраняет прежний состав, поэтому из «Лидов» никто не
    // исчезает (иначе мы просто перенесли бы «дыру» на другие базы, где у
    // funnel='new' есть закрытый абонемент с несинхронизированным clientStatus).
    base.funnelStatus = "new"
    base.OR = [
      { payments: { none: {} } },
      {
        subscriptions: { none: { deletedAt: null } },
        attendances: { none: { chargeAmount: { gt: 0 } } },
      },
    ]
  } else if (tab === "potential") {
    // Потенциал = funnelStatus. Клиент с активной заявкой ОСТАЁТСЯ здесь с баджем
    // «Заявка» — как в «Лидах» (см. выше). Прежняя модель (6925fa1) прятала
    // родителя с активным pipeline из статус-вкладок, оставляя его только в
    // «Продажах» и «Все» (NO_ACTIVE_APP). Для «Лидов» это уже отменили, а для
    // «Потенциала» — нет: клиент funnel=potential с новой заявкой пропадал из
    // своей вкладки (виден только во «Все»). Убрано — вкладка снова полная.
    base.funnelStatus = "potential"
  } else if (tab === "nontarget") {
    base.funnelStatus = "non_target"
  } else if (tab === "active") {
    // «Активный» = текущий рабочий статус клиента. Меняется при первой оплате
    // (active), отчислении (churned), архивации (archived). Привязка к
    // существованию active-абонемента давала 0 для тенантов, где между
    // периодами абонементов нет, хотя клиент по сути работает.
    base.clientStatus = "active"
    // Воронка archived/blacklisted побеждает: исторический рассинхрон не должен
    // показывать архивных клиентов во вкладке «Активные».
    base.funnelStatus = { notIn: ["archived", "blacklisted"] }
  } else if (tab === "churned") {
    base.clientStatus = "churned"
    base.funnelStatus = { notIn: ["archived", "blacklisted"] }
  } else if (tab === "archived") {
    base.funnelStatus = "archived"
  } else if (tab === "blacklist") {
    base.funnelStatus = "blacklisted"
  }
  // ADM-04: сегментный scope (см. client-segments.ts) — клиент попадает в
  // выборку только если хотя бы одно из правил видимости по его статусу
  // совпадает с филиалами сессии.
  const parts: Prisma.ClientWhereInput[] = [base]
  const segmentScope = scopeClientByBranch(scope)
  if (Object.keys(segmentScope).length > 0) parts.push(segmentScope)
  if (branchFilter) parts.push(branchColumnWhere(branchFilter))
  return parts.length > 1 ? { AND: parts } : base
}

export function countTab(
  tab: ContactsTabKey,
  tenantId: string,
  scope: BranchScope,
  branchFilter: string | null,
): Promise<number> {
  return db.client.count({ where: buildWhere(tab, tenantId, scope, branchFilter) })
}

/** Поиск по вкладке: токены ФИО родителя/ребёнка + телефон по цифрам. */
export function withSearch(
  baseWhere: Prisma.ClientWhereInput,
  query: string,
): Prisma.ClientWhereInput {
  if (!query) return baseWhere
  // Поиск-по-токенам: каждое слово запроса должно совпасть с одним из полей
  // (имя/фамилия родителя или ребёнка). Иначе «Фамилия Имя» не находилось,
  // потому что в одном поле такой подстроки нет.
  const tokens = query.split(/\s+/).map((t) => t.trim()).filter(Boolean)
  const digits = query.replace(/\D/g, "")
  const tokenClauses: Prisma.ClientWhereInput[] = tokens.map((token) => ({
    OR: [
      { firstName: { contains: token, mode: "insensitive" } },
      { lastName: { contains: token, mode: "insensitive" } },
      {
        wards: {
          some: {
            OR: [
              { firstName: { contains: token, mode: "insensitive" } },
              { lastName: { contains: token, mode: "insensitive" } },
            ],
          },
        },
      },
    ],
  }))
  const altOr: Prisma.ClientWhereInput[] = []
  if (tokenClauses.length > 0) altOr.push({ AND: tokenClauses })
  if (digits) altOr.push({ phone: { contains: digits } })
  return { AND: [baseWhere, { OR: altOr }] }
}

export interface LoadContactRowsArgs {
  tenantId: string
  scope: BranchScope
  tab: ContactsTabKey
  query: string
  branchFilter: string | null
  role: string
  instructorsSeePhones: boolean
}

/** Строки вкладки — ровно те, что рендерит таблица (и что уходят в выгрузку). */
export async function loadContactRows({
  tenantId,
  scope,
  tab,
  query,
  branchFilter,
  role,
  instructorsSeePhones,
}: LoadContactRowsArgs): Promise<ContactRow[]> {
  const where = withSearch(buildWhere(tab, tenantId, scope, branchFilter), query)

  const clients = await db.client.findMany({
    where,
    include: {
      wards: true,
      branch: { select: { id: true, name: true } },
      secondBranch: { select: { id: true, name: true } },
      channel: { select: { id: true, name: true } },
      // Все активные абонементы: колонки направления/группы/инструктора берут
      // самый свежий ([0]), а колонка «Филиал» и фильтр по филиалу должны
      // видеть ВСЕ филиалы активных абонементов — иначе клиент с детьми в
      // двух филиалах при фильтре по «старшему» выглядел бы как баг фильтра.
      subscriptions: {
        where: { status: "active", deletedAt: null },
        orderBy: { startDate: "desc" },
        include: {
          direction: { select: { id: true, name: true } },
          group: {
            select: {
              id: true,
              name: true,
              branch: { select: { id: true, name: true } },
              instructor: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      },
    },
    // Как в «Продажах»: грузим фактически всю вкладку — клиентская сортировка
    // по заголовкам должна сортировать весь список, а не первые N строк
    // серверного порядка (у крупных тенантов вкладка «Все» — 3000+ строк).
    orderBy: [{ nextContactDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 10000,
  })

  // Сегмент клиента считается лениво из настроек (Organization.segmentationConfig).
  // Для mode="amount" агрегируем Σ subscriptions.chargedAmount по всем клиентам
  // страницы одним запросом; для mode="months" хватает firstPaymentDate из Client.
  // Для лидов / неактивных клиентов колонка сегмента в UI не показывается — для
  // них оставляем "new_client" как технический дефолт.
  const orgForSeg = await db.organization.findUnique({
    where: { id: tenantId },
    select: { segmentationConfig: true },
  })
  const segConfig = parseSegmentationConfig(orgForSeg?.segmentationConfig)
  const chargedByClient = new Map<string, number>()
  if (segConfig?.mode === "amount") {
    const activeIds = clients
      .filter((c) => c.clientStatus === "active")
      .map((c) => c.id)
    if (activeIds.length > 0) {
      const sums = await db.subscription.groupBy({
        by: ["clientId"],
        where: { tenantId, clientId: { in: activeIds }, deletedAt: null },
        _sum: { chargedAmount: true },
      })
      for (const s of sums) {
        chargedByClient.set(s.clientId, Number(s._sum.chargedAmount ?? 0))
      }
    }
  }

  return clients.map((c) => {
    const sub = c.subscriptions[0]
    const instrName = sub?.group?.instructor
      ? [sub.group.instructor.lastName, sub.group.instructor.firstName].filter(Boolean).join(" ") || "—"
      : "—"
    const metric = segConfig
      ? segConfig.mode === "amount"
        ? chargedByClient.get(c.id) ?? 0
        : monthsSince(c.firstPaymentDate)
      : 0
    // Эффективный сегмент = ручное переопределение (баг #26) ?? авто-расчёт.
    // Override работает даже без конфига; для не-активных сегмент не показывается.
    const computedSeg =
      segConfig && c.clientStatus === "active"
        ? computeSegment(metric, segConfig)
        : "new_client"
    const segment =
      c.clientStatus === "active"
        ? effectiveSegment(c.segmentOverride as ClientSegmentKey | null, computedSeg)
        : "new_client"
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: maskPhone(c.phone, role, instructorsSeePhones),
      socialLink: c.socialLink,
      segment,
      channelName: c.channel?.name ?? null,
      // Филиал строки = ручные поля карточки (модель Анны, 13.08.2026):
      // «Филиал» + «Второй филиал», через запятую. Пусто → «—».
      branchName: [c.branch?.name, c.secondBranch?.name].filter(Boolean).join(", ") || null,
      funnelStatus: c.funnelStatus,
      clientStatus: c.clientStatus,
      comment: c.comment,
      nextContactDate: c.nextContactDate ? c.nextContactDate.toISOString() : null,
      assignedTo: c.assignedTo,
      createdAt: c.createdAt.toISOString(),
      wards: c.wards.map((w) => ({
        id: w.id,
        firstName: w.firstName,
        lastName: w.lastName,
        birthDate: w.birthDate ? w.birthDate.toISOString() : null,
      })),
      activeSubscription: sub
        ? {
            directionName: sub.direction.name,
            groupName: sub.group.name,
            branchName: sub.group.branch?.name ?? null,
            instructor: { id: sub.group.instructor?.id ?? null, name: instrName },
          }
        : null,
      hasActiveSubscription: c.subscriptions.length > 0,
      topSalesStage: pickTopSalesStage(c.wards.map((w) => w.salesStage)),
    }
  })
}
