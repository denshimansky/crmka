import { db } from "@/lib/db"
import {
  FUNNEL_STAGE_LABELS,
  type FunnelDetailRow,
  type FunnelScheme,
  type FunnelSchemeKey,
  type FunnelStage,
  type FunnelStageKey,
  type FunnelTab,
  type SalesFunnelData,
} from "@/lib/reports/sales-funnel-types"
import { scopeApplication, type BranchScope } from "@/lib/branch-scope"
import { scopeClientByBranch } from "@/lib/client-segments"

// Отчёт CRM-13 «Воронка продаж» — событийная воронка по заявкам.
//
// Две вкладки: «новые» (на момент создания заявки клиент был Лидом/Потенциалом)
// и «действующие» (на момент создания заявки — Активный/Выбывший, т.е. уже покупал).
// В каждой вкладке две схемы: «с пробным» и «без пробного» — заявка относится к
// схеме по наличию хотя бы одного не-отменённого пробного.
//
// Каждый этап считается в двух разрезах:
// - «текущий месяц» — заявка создана в выбранном месяце;
// - «перетекающие» — заявка создана раньше, а действие (пробное/визит/покупка)
//   совершено в выбранном месяце.
// У этапов «Лид» и «Заявка» перетекающих не бывает: их действие — само создание.

function fullName(first: string | null, last: string | null): string {
  return [last, first].filter(Boolean).join(" ") || "Без имени"
}

// Даты покупки (firstPaymentDate, firstPaidLessonDate) хранятся как @db.Date
// (полночь UTC), а createdAt — полный timestamp. Все сравнения «стал клиентом
// до X» делаем на гранулярности календарного дня UTC, иначе покупка в день
// создания заявки «обгоняет» заявку и новый клиент уезжает в «действующие».
function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export async function computeSalesFunnel(
  tenantId: string,
  year: number,
  month: number,
  opts: { withRows?: boolean; scope?: BranchScope } = {},
): Promise<SalesFunnelData> {
  const withRows = opts.withRows ?? true
  const scope: BranchScope = opts.scope ?? { mode: "all" }
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

  const clientScope = scopeClientByBranch(scope)

  const [apps, monthClients] = await Promise.all([
    // Заявки, у которых возможно событие в выбранном месяце: созданы в месяце
    // («Заявка» + текущий разрез) либо созданы раньше, но в месяце есть пробное,
    // выигрыш или первое платное занятие клиента (перетекающие). Без этого OR
    // выборка тянула бы все заявки тенанта за всю историю.
    db.application.findMany({
      where: {
        tenantId,
        deletedAt: null,
        createdAt: { lte: monthEnd },
        client: { deletedAt: null },
        ...scopeApplication(scope),
        OR: [
          { createdAt: { gte: monthStart } },
          { processedAt: { gte: monthStart, lte: monthEnd } },
          {
            trialLessons: {
              some: {
                status: { not: "cancelled" },
                scheduledDate: { gte: monthStart, lte: monthEnd },
              },
            },
          },
          // Ветка тянет ВСЕ заявки клиента с первым платным занятием в месяце —
          // атрибуция paidLessonWonApp («самая ранняя заявка») остаётся точной.
          { client: { firstPaidLessonDate: { gte: monthStart, lte: monthEnd } } },
        ],
      },
      select: {
        id: true,
        createdAt: true,
        processedToStatus: true,
        processedAt: true,
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            clientStatus: true,
            firstPaymentDate: true,
            firstPaidLessonDate: true,
          },
        },
        ward: { select: { id: true, firstName: true, lastName: true } },
        branch: { select: { name: true } },
        direction: { select: { id: true, name: true } },
        trialLessons: {
          where: { status: { not: "cancelled" } },
          orderBy: { scheduledDate: "asc" },
          select: {
            status: true,
            scheduledDate: true,
            group: { select: { name: true } },
          },
        },
      },
    }),
    // Этап «Лид» — контакты, созданные в выбранном месяце.
    db.client.findMany({
      where: {
        tenantId,
        deletedAt: null,
        createdAt: { gte: monthStart, lte: monthEnd },
        ...(Object.keys(clientScope).length > 0 ? { AND: [clientScope] } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        funnelStatus: true,
        firstPaymentDate: true,
        firstPaidLessonDate: true,
        createdAt: true,
        wards: {
          select: { firstName: true, lastName: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    }),
  ])

  const clientIds = Array.from(
    new Set([...apps.map((a) => a.client.id), ...monthClients.map((c) => c.id)]),
  )

  // Лёгкие агрегаты по клиентам выборки: купленные абонементы (becameClientAt +
  // группа для детализации «Купил»), история won-заявок (выборка apps сужена до
  // событий месяца — старые won видны только так) и первые платные отметки
  // (клиент мог стать активным через разовое занятие без абонемента и won).
  const [subs, wonHistory, paidAttendance] = clientIds.length
    ? await Promise.all([
        db.subscription.findMany({
          where: {
            tenantId,
            deletedAt: null,
            clientId: { in: clientIds },
            status: { in: ["active", "closed", "withdrawn"] },
          },
          select: {
            clientId: true,
            wardId: true,
            directionId: true,
            activatedAt: true,
            createdAt: true,
            group: { select: { name: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        db.application.groupBy({
          by: ["clientId"],
          where: {
            tenantId,
            deletedAt: null,
            clientId: { in: clientIds },
            processedToStatus: "won",
          },
          _min: { processedAt: true },
        }),
        db.attendance.groupBy({
          by: ["clientId"],
          where: { tenantId, clientId: { in: clientIds }, chargeAmount: { gt: 0 } },
          _min: { markedAt: true },
        }),
      ])
    : [[], [], []]

  // becameClientAt: самая ранняя из дат «клиент купил» — первая оплата, первое
  // платное занятие, выигранная заявка, активированный абонемент, платная отметка.
  // На импортированных данных часть дат отсутствует — поэтому минимум по всем.
  const becameClientAt = new Map<string, Date>()
  const bump = (clientId: string, d: Date | null | undefined) => {
    if (!d) return
    const prev = becameClientAt.get(clientId)
    if (!prev || d < prev) becameClientAt.set(clientId, d)
  }
  for (const a of apps) {
    bump(a.client.id, a.client.firstPaymentDate)
    bump(a.client.id, a.client.firstPaidLessonDate)
  }
  for (const c of monthClients) {
    bump(c.id, c.firstPaymentDate)
    bump(c.id, c.firstPaidLessonDate)
  }
  for (const s of subs) {
    bump(s.clientId, s.activatedAt ?? s.createdAt)
  }
  for (const w of wonHistory) {
    bump(w.clientId, w._min.processedAt)
  }
  for (const a of paidAttendance) {
    bump(a.clientId, a._min.markedAt)
  }

  // Был ли клиент действующим (Активный/Выбывший) на момент даты `at` —
  // по календарному дню: покупка в день создания заявки = ещё «новый».
  // Фолбэк для импортированных без истории покупок: текущий clientStatus.
  const wasExistingAt = (
    client: { id: string; clientStatus: string | null },
    at: Date,
  ): boolean => {
    const became = becameClientAt.get(client.id)
    if (became) return utcDayStart(became) < utcDayStart(at)
    return client.clientStatus === "active" || client.clientStatus === "churned"
  }

  // «Купил» через первое платное занятие (без выигранной заявки): дата клиентская,
  // а не заявочная — относим её к самой ранней заявке клиента, созданной не позже
  // этого дня, и только если у клиента нет ни одной won-заявки (иначе задвоение).
  // clientsWithWon — из глобального агрегата, а не оконной выборки, чтобы покупка
  // не считалась дважды в разных месяцах.
  const clientsWithWon = new Set(wonHistory.map((w) => w.clientId))
  const paidLessonWonApp = new Map<string, string>() // clientId -> applicationId
  for (const a of [...apps].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    const d = a.client.firstPaidLessonDate
    if (!d || clientsWithWon.has(a.client.id)) continue
    if (paidLessonWonApp.has(a.client.id)) continue
    if (utcDayStart(a.createdAt) <= d) paidLessonWonApp.set(a.client.id, a.id)
  }

  // Группа купленного абонемента: по подопечному + направлению заявки, фолбэк —
  // по клиенту (абонемент может быть без подопечного). Берём последний абонемент,
  // купленный не позже конца отчётного месяца, иначе самый ранний.
  const subGroups = new Map<string, { name: string; at: number }[]>()
  for (const s of subs) {
    const at = (s.activatedAt ?? s.createdAt).getTime()
    for (const key of [
      `w:${s.wardId ?? ""}|${s.directionId}`,
      `c:${s.clientId}|${s.directionId}`,
    ]) {
      const arr = subGroups.get(key)
      if (arr) arr.push({ name: s.group.name, at })
      else subGroups.set(key, [{ name: s.group.name, at }])
    }
  }
  const subGroupFor = (
    wardId: string,
    clientId: string,
    directionId: string | null,
  ): string | null => {
    if (!directionId) return null
    const list =
      subGroups.get(`w:${wardId}|${directionId}`) ?? subGroups.get(`c:${clientId}|${directionId}`)
    if (!list || list.length === 0) return null
    let best: { name: string; at: number } | null = null
    for (const item of list) {
      if (item.at <= monthEnd.getTime() && (!best || item.at > best.at)) best = item
    }
    return (best ?? list[0]).name
  }

  const inMonth = (d: Date | null | undefined): boolean =>
    !!d && d >= monthStart && d <= monthEnd

  type StageBucket = { current: number; carryover: number; rows: FunnelDetailRow[] }
  const emptyBucket = (): StageBucket => ({ current: 0, carryover: 0, rows: [] })
  const buckets = new Map<string, StageBucket>() // `${tab}|${scheme}|${stage}`
  const bucket = (tab: FunnelTab, scheme: FunnelSchemeKey, stage: FunnelStageKey) => {
    const key = `${tab}|${scheme}|${stage}`
    let b = buckets.get(key)
    if (!b) {
      b = emptyBucket()
      buckets.set(key, b)
    }
    return b
  }
  const addEvent = (
    tab: FunnelTab,
    scheme: FunnelSchemeKey,
    stage: FunnelStageKey,
    carryover: boolean,
    row: FunnelDetailRow,
  ) => {
    const b = bucket(tab, scheme, stage)
    if (carryover) b.carryover++
    else b.current++
    if (withRows) b.rows.push(row)
  }

  for (const a of apps) {
    const tab: FunnelTab = wasExistingAt(a.client, a.createdAt) ? "existing" : "new"
    const scheme: FunnelSchemeKey = a.trialLessons.length > 0 ? "with_trial" : "no_trial"
    const appInMonth = inMonth(a.createdAt)
    const carryover = a.createdAt < monthStart

    const baseRow = {
      clientId: a.client.id,
      parentName: fullName(a.client.firstName, a.client.lastName),
      phone: a.client.phone,
      wardName: fullName(a.ward.firstName, a.ward.lastName),
      branchName: a.branch?.name ?? null,
      directionName: a.direction?.name ?? null,
      carryover,
    }

    // Этап «Заявка» — только текущий месяц (действие = создание заявки).
    if (appInMonth) {
      addEvent(tab, scheme, "application", false, {
        ...baseRow,
        carryover: false,
        groupName: null,
        date: a.createdAt.toISOString(),
      })
    }

    // Этапы пробного — по дате занятия (scheduledDate); заявка считается один раз.
    const monthTrials = a.trialLessons.filter((t) => inMonth(t.scheduledDate))
    if (monthTrials.length > 0) {
      const first = monthTrials[0]
      addEvent(tab, scheme, "trial", carryover, {
        ...baseRow,
        groupName: first.group?.name ?? null,
        date: first.scheduledDate.toISOString(),
      })
    }
    const attended = monthTrials.filter((t) => t.status === "attended")
    if (attended.length > 0) {
      const first = attended[0]
      addEvent(tab, scheme, "trial_attended", carryover, {
        ...baseRow,
        groupName: first.group?.name ?? null,
        date: first.scheduledDate.toISOString(),
      })
    }

    // Этап «Купил»: оплачен абонемент по заявке (won) либо первое платное занятие.
    const wonDate =
      a.processedToStatus === "won" && a.processedAt
        ? a.processedAt
        : paidLessonWonApp.get(a.client.id) === a.id
          ? a.client.firstPaidLessonDate
          : null
    if (inMonth(wonDate)) {
      const lastTrialGroup =
        a.trialLessons.length > 0
          ? (a.trialLessons[a.trialLessons.length - 1].group?.name ?? null)
          : null
      addEvent(tab, scheme, "won", carryover, {
        ...baseRow,
        groupName:
          subGroupFor(a.ward.id, a.client.id, a.direction?.id ?? null) ?? lastTrialGroup,
        date: wonDate!.toISOString(),
      })
    }
  }

  // Этап «Лид» (только вкладка «новые»): контакты, вошедшие в воронку новым лидом
  // в выбранном месяце — созданы в месяце и сейчас в статусе «Новый» (funnelStatus
  // = new). Это совпадает со вкладкой «Лиды» в списке контактов и НЕ зависит от
  // источника: импортированная база, залитая сразу выбывшими/потенциалом/архивом/
  // активными, в «Лиды» не попадает (именно она раздувала цифру), а реальные лиды —
  // в т.ч. импортированные как «Новый» — считаются. Контакты, ушедшие дальше по
  // воронке (заявка/пробное/покупка), статус «Новый» уже потеряли и видны в своих
  // этапах через apps, поэтому здесь не двоятся.
  for (const c of monthClients) {
    if (c.funnelStatus !== "new") continue
    const row: FunnelDetailRow = {
      clientId: c.id,
      parentName: fullName(c.firstName, c.lastName),
      phone: c.phone,
      wardName: c.wards[0] ? fullName(c.wards[0].firstName, c.wards[0].lastName) : null,
      branchName: null,
      directionName: null,
      groupName: null,
      carryover: false,
      date: c.createdAt.toISOString(),
    }
    // Лид ещё не имеет заявки, поэтому схема неизвестна — показываем одинаково
    // в обеих схемах вкладки «новые» (в сводке считается один раз).
    addEvent("new", "with_trial", "lead", false, row)
    addEvent("new", "no_trial", "lead", false, row)
  }

  const stageList = (tab: FunnelTab, scheme: FunnelSchemeKey): FunnelStageKey[] => {
    const base: FunnelStageKey[] =
      scheme === "with_trial"
        ? ["application", "trial", "trial_attended", "won"]
        : ["application", "won"]
    return tab === "new" ? ["lead", ...base] : base
  }

  const build = (tab: FunnelTab): FunnelScheme[] =>
    (["with_trial", "no_trial"] as FunnelSchemeKey[]).map((scheme) => ({
      key: scheme,
      stages: stageList(tab, scheme).map((stage) => {
        const b = buckets.get(`${tab}|${scheme}|${stage}`) ?? emptyBucket()
        b.rows.sort((x, y) => x.date.localeCompare(y.date))
        return { key: stage, current: b.current, carryover: b.carryover, rows: b.rows }
      }),
    }))

  return { new: build("new"), existing: build("existing") }
}

/** Суммарные цифры за месяц для дашборда: этап → одна цифра (текущие + перетекающие). */
export function summarizeSalesFunnel(
  data: SalesFunnelData,
): { key: FunnelStageKey; label: string; count: number }[] {
  const total = (stage: FunnelStage | undefined) =>
    stage ? stage.current + stage.carryover : 0
  const find = (schemes: FunnelScheme[], scheme: FunnelSchemeKey, stage: FunnelStageKey) =>
    schemes.find((s) => s.key === scheme)?.stages.find((s) => s.key === stage)

  // «Лид» одинаков в обеих схемах вкладки «новые» — берём один раз.
  const lead = total(find(data.new, "with_trial", "lead"))
  const sumBoth = (stage: FunnelStageKey) =>
    (["with_trial", "no_trial"] as FunnelSchemeKey[]).reduce(
      (acc, scheme) =>
        acc + total(find(data.new, scheme, stage)) + total(find(data.existing, scheme, stage)),
      0,
    )

  return [
    { key: "lead", label: FUNNEL_STAGE_LABELS.lead + "ы", count: lead },
    { key: "application", label: "Заявки", count: sumBoth("application") },
    { key: "trial", label: "Пробные", count: sumBoth("trial") },
    { key: "trial_attended", label: "Пришли на пробное", count: sumBoth("trial_attended") },
    { key: "won", label: "Купили", count: sumBoth("won") },
  ]
}
