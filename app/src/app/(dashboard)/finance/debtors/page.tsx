import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { oneOffDebtByClient } from "@/lib/one-off-debt"
import { scopeClientByBranch } from "@/lib/client-segments"
import { scopeBranch } from "@/lib/branch-scope"
import { clientStateLabel } from "@/lib/clients/state-label"
import { BranchSwitcher } from "./branch-switcher"
import { StatusFilter } from "./status-filter"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertTriangle, Users, Wallet } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { PageHelp } from "@/components/page-help"
import { ReportExport } from "@/components/report-export"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { EditableDateCell, EditableTextCell } from "../../crm/_components/editable-cell"
import { formatMoney as fmtCurrency } from "@/lib/currency"
import { getOrgUiSettings } from "@/lib/role-names"

function formatDate(date: Date | null): string {
  if (!date) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

// Цвет бейджа статуса клиента (метки из clientStateLabel).
function statusBadgeClass(label: string): string {
  switch (label) {
    case "Активный":
      return "border-transparent bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
    case "Выбывший":
      return "border-transparent bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
    case "Архив":
      return "border-transparent bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
    case "Чёрный список":
      return "border-transparent bg-zinc-800 text-white dark:bg-zinc-700"
    case "Нецелевой":
      return "border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
    case "Потенциал":
      return "border-transparent bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
    default: // Лид
      return "border-transparent bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
  }
}

// Опции фильтра по статусу клиента (баг #109). Метки обязаны совпадать с выводом
// clientStateLabel — по ним фильтруются строки.
const STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: "active", label: "Активный" },
  { key: "churned", label: "Выбывший" },
  { key: "potential", label: "Потенциал" },
  { key: "lead", label: "Лид" },
  { key: "archived", label: "Архив" },
  { key: "blacklisted", label: "Чёрный список" },
  { key: "non_target", label: "Нецелевой" },
]

type TabKey = "planned" | "actual" | "balance"

export default async function DebtorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const currency = (await getOrgUiSettings(tenantId))?.currency ?? "RUB"
  const formatMoney = (amount: number): string => fmtCurrency(amount, currency)
  const scope = await getBranchScope()
  const clientScope = scopeClientByBranch(scope)
  // Редактировать обещанную дату/комментарий может любая роль, кроме «только чтение».
  const canEdit = session.user.role !== "readonly"

  const sp = await searchParams
  const tab: TabKey =
    sp.tab === "actual" ? "actual" : sp.tab === "balance" ? "balance" : "planned"

  // Переключатель филиалов (баг #107): список филиалов в пределах доступа
  // пользователя + выбранный филиал из URL (?branch=<id>). Пусто = все филиалы.
  const branchOptions = await db.branch.findMany({
    where: { tenantId, deletedAt: null, ...scopeBranch(scope) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  const branchParam = typeof sp.branch === "string" ? sp.branch : null
  const selectedBranchId =
    branchParam && branchOptions.some((b) => b.id === branchParam) ? branchParam : null

  // Фильтр по статусу клиента (баг #109): ключ из URL (?status=<key>) → метка.
  const statusParam = typeof sp.status === "string" ? sp.status : null
  const selectedStatus = STATUS_OPTIONS.find((s) => s.key === statusParam) ?? null

  // Подтягиваем клиентов, у которых ЕСТЬ потенциальный долг (любого типа):
  //   - есть не-отчисленный абонемент с остатком к оплате (balance>0) — кандидат
  //     в плановый долг;
  //   - ИЛИ есть не-отчисленный абонемент с накоплёнными списаниями (chargedAmount>0) —
  //     кандидат в фактический долг (он мог уже оплатить часть, но списано больше).
  // Дальше отфильтруем уже в JS по выбранному tab'у.
  // Кандидаты и clientScope оба строятся на OR — объединяем через AND, иначе
  // spread перезаписал бы ключ OR и фильтр кандидатов долга терялся бы.
  // На вкладке «Баланс» долговые кандидаты не нужны — грузим отдельно ниже.
  const candidates = tab === "balance" ? [] : await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
      AND: [
        {
          OR: [
            {
              subscriptions: {
                some: {
                  deletedAt: null,
                  status: { not: "withdrawn" },
                  OR: [{ balance: { gt: 0 } }, { chargedAmount: { gt: 0 } }],
                },
              },
            },
            // Отрицательный баланс клиента, не привязанный к абонементу: разовые
            // посещения без оплаты (обе вкладки) и перенесённый/импортный долг
            // (только «Фактический»).
            { clientBalance: { lt: 0 } },
          ],
        },
        ...(Object.keys(clientScope).length > 0 ? [clientScope] : []),
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      clientBalance: true,
      promisedPaymentDate: true,
      comment: true,
      phone: true,
      funnelStatus: true,
      clientStatus: true,
      branch: { select: { id: true, name: true } },
      subscriptions: {
        where: {
          deletedAt: null,
          status: { not: "withdrawn" },
        },
        select: {
          id: true,
          status: true,
          direction: { select: { name: true } },
          group: { select: { branch: { select: { id: true, name: true } } } },
          ward: { select: { id: true, firstName: true, lastName: true } },
          periodYear: true,
          periodMonth: true,
          balance: true,
          finalAmount: true,
          chargedAmount: true,
        },
      },
    },
  })

  // Декомпозиция минусового баланса по ledger (см. lib/one-off-debt.ts):
  // часть от разовых посещений — реальный долг «здесь и сейчас», показываем на
  // обеих вкладках; остаток — перенесённый/импортный долг, только на «Фактическом».
  const negIds = candidates.filter((c) => Number(c.clientBalance) < 0).map((c) => c.id)
  const oneOffDebtMap = await oneOffDebtByClient(tenantId, candidates)
  const oneOffMetaByClient = new Map<string, { dates: string[]; wardId: string | null; wardName: string | null }>()
  if (negIds.length > 0) {
    // Детали для колонок «Ребёнок»/«Источник»: живые заряженные разовые отметки
    const oneOffAtts = await db.attendance.findMany({
      where: {
        tenantId,
        clientId: { in: negIds },
        subscriptionId: null,
        isPending: false,
        chargeAmount: { gt: 0 },
      },
      select: {
        clientId: true,
        wardId: true,
        lesson: { select: { date: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    // У Attendance нет relation на Ward — имена подтягиваем батчем по wardId
    const wardIds = [...new Set(oneOffAtts.map((a) => a.wardId).filter(Boolean))] as string[]
    const wards = wardIds.length
      ? await db.ward.findMany({
          where: { id: { in: wardIds }, tenantId },
          select: { id: true, firstName: true, lastName: true },
        })
      : []
    const wardById = new Map(wards.map((w) => [w.id, w]))
    for (const a of oneOffAtts) {
      const meta = oneOffMetaByClient.get(a.clientId) || { dates: [], wardId: null, wardName: null }
      if (meta.dates.length < 3) {
        meta.dates.push(new Date(a.lesson.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }))
      }
      if (!meta.wardId && a.wardId) {
        const w = wardById.get(a.wardId)
        if (w) {
          meta.wardId = w.id
          meta.wardName = [w.lastName, w.firstName].filter(Boolean).join(" ") || null
        }
      }
      oneOffMetaByClient.set(a.clientId, meta)
    }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  type Source = { key: string; label: string; amount: number; wardId: string | null; wardName: string | null }
  type Row = {
    id: string
    name: string
    status: string
    branchName: string
    directions: string
    debt: number
    promised: Date | null
    promisedIso: string | null
    comment: string | null
    isOverdue: boolean
    phone: string | null
    sources: Source[]
  }

  function subLabel(s: { direction: { name: string }; periodMonth: number | null; periodYear: number | null; status: string }): string {
    const period = s.periodMonth && s.periodYear
      ? ` (${String(s.periodMonth).padStart(2, "0")}.${s.periodYear})`
      : ""
    const tag = s.status === "closed" ? ", закрыт" : ""
    return `${s.direction.name}${period}${tag}`
  }

  const allRows: Row[] = []
  for (const c of candidates) {
    const name = [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
    const promised = c.promisedPaymentDate
    const isOverdue = !!(promised && promised < today)
    const directionsSet = new Set<string>()
    // Филиал долга берём из групп абонементов, формирующих долг (поле branchId
    // у самого клиента обычно пустое). Фоллбэк — филиал клиента.
    const branchSet = new Set<string>()

    // Филиалы, с которыми связан клиент (свой филиал + филиалы групп его
    // абонементов). Клиентские долги (разовые/перенесённый) привязываем к ним —
    // у них нет собственного филиала (баг #107).
    const clientBranchIds = new Set<string>()
    if (c.branch?.id) clientBranchIds.add(c.branch.id)
    for (const sub of c.subscriptions) {
      if (sub.group.branch?.id) clientBranchIds.add(sub.group.branch.id)
    }
    const clientLevelBranchMatch =
      !selectedBranchId || clientBranchIds.has(selectedBranchId)

    const sources: Source[] = []
    let debt = 0
    for (const sub of c.subscriptions) {
      // Фильтр по филиалу: абонементы других филиалов не учитываем (баг #107).
      if (selectedBranchId && sub.group.branch?.id !== selectedBranchId) continue
      const balance = Number(sub.balance)
      const finalAmount = Number(sub.finalAmount)
      const chargedAmount = Number(sub.chargedAmount)
      directionsSet.add(sub.direction.name)
      const wardId = sub.ward?.id ?? null
      const wardName = sub.ward
        ? [sub.ward.lastName, sub.ward.firstName].filter(Boolean).join(" ") || null
        : null

      if (tab === "planned") {
        // Плановый долг по абонементу = balance (сколько ещё надо оплатить).
        if (balance > 0) {
          sources.push({
            key: `sub:${sub.id}`,
            label: subLabel(sub),
            amount: balance,
            wardId,
            wardName,
          })
          debt += balance
          if (sub.group.branch?.name) branchSet.add(sub.group.branch.name)
        }
      } else {
        // Фактический долг = списано (chargedAmount) − оплачено за этот абонемент.
        // Оплачено = finalAmount − balance. Итого: chargedAmount + balance − finalAmount.
        const fact = chargedAmount + balance - finalAmount
        if (fact > 0) {
          sources.push({
            key: `sub:${sub.id}`,
            label: subLabel(sub),
            amount: fact,
            wardId,
            wardName,
          })
          debt += fact
          if (sub.group.branch?.name) branchSet.add(sub.group.branch.name)
        }
      }
    }

    const branchName =
      branchSet.size > 0 ? Array.from(branchSet).join(", ") : c.branch?.name || "—"

    // Минусовой баланс клиента: часть от разовых посещений — долг «здесь и
    // сейчас», виден на обеих вкладках; остаток (перенесённый/импортный) —
    // только во «Фактическом».
    const totalNeg = Math.max(0, -Number(c.clientBalance))
    if (totalNeg > 0 && clientLevelBranchMatch) {
      const oneOffDebt = oneOffDebtMap.get(c.id) || 0
      const carried = totalNeg - oneOffDebt
      if (oneOffDebt > 0) {
        const meta = oneOffMetaByClient.get(c.id)
        sources.push({
          key: "oneoff",
          label: `Разовые посещения${meta && meta.dates.length ? ` (${meta.dates.join(", ")})` : ""}`,
          amount: oneOffDebt,
          wardId: meta?.wardId ?? null,
          wardName: meta?.wardName ?? null,
        })
        debt += oneOffDebt
      }
      if (tab === "actual" && carried > 0) {
        sources.push({ key: "carried", label: "Перенесённый долг (импорт/закрытие)", amount: carried, wardId: null, wardName: null })
        debt += carried
      }
    }

    if (debt <= 0) continue
    sources.sort((a, b) => b.amount - a.amount)
    allRows.push({
      id: c.id,
      name,
      status: clientStateLabel(c.funnelStatus, c.clientStatus),
      branchName,
      directions: directionsSet.size > 0 ? Array.from(directionsSet).join(", ") : "—",
      debt,
      promised,
      promisedIso: promised ? promised.toISOString().slice(0, 10) : null,
      comment: c.comment,
      isOverdue,
      phone: c.phone,
      sources: sources.slice(0, 4),
    })
  }
  allRows.sort((a, b) => b.debt - a.debt)

  // Фильтр по статусу клиента (баг #109) — до сводки, чтобы карточки её учитывали.
  const rows = selectedStatus
    ? allRows.filter((r) => r.status === selectedStatus.label)
    : allRows

  const totalDebt = rows.reduce((s, r) => s + r.debt, 0)
  const overdueCount = rows.filter((r) => r.isOverdue).length

  // ─── Вкладка «Баланс»: клиенты с положительным clientBalance (деньги родителя:
  // предоплата/переплата, доступны к списанию за занятия и разовые посещения). ───
  const balanceClients =
    tab === "balance"
      ? await db.client.findMany({
          where: {
            tenantId,
            deletedAt: null,
            AND: [
              { clientBalance: { gt: 0 } },
              ...(Object.keys(clientScope).length > 0 ? [clientScope] : []),
            ],
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            clientBalance: true,
            phone: true,
            comment: true,
            funnelStatus: true,
            clientStatus: true,
            branch: { select: { id: true, name: true } },
            wards: {
              select: { id: true, firstName: true, lastName: true },
            },
            subscriptions: {
              where: { deletedAt: null, status: { not: "withdrawn" } },
              select: { group: { select: { branch: { select: { id: true, name: true } } } } },
            },
          },
        })
      : []

  type BalanceRow = {
    id: string
    name: string
    status: string
    wards: { id: string; name: string }[]
    branchName: string
    balance: number
    phone: string | null
    comment: string | null
  }

  const balanceRows: BalanceRow[] = balanceClients
    // Фильтр по филиалу (баг #107): баланс — деньги клиента (уровень клиента),
    // показываем его в филиалах, с которыми клиент связан (свой филиал или
    // филиалы групп его абонементов).
    .filter((c) => {
      if (!selectedBranchId) return true
      const ids = new Set<string>()
      if (c.branch?.id) ids.add(c.branch.id)
      for (const s of c.subscriptions) {
        if (s.group?.branch?.id) ids.add(s.group.branch.id)
      }
      return ids.has(selectedBranchId)
    })
    .map((c) => {
      // Филиал — из групп абонементов (у клиента branchId часто пуст), фоллбэк — филиал клиента.
      const branchSet = new Set<string>()
      for (const s of c.subscriptions) {
        if (s.group?.branch?.name) branchSet.add(s.group.branch.name)
      }
      return {
        id: c.id,
        name: [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени",
        status: clientStateLabel(c.funnelStatus, c.clientStatus),
        wards: c.wards.map((w) => ({
          id: w.id,
          name: [w.lastName, w.firstName].filter(Boolean).join(" ") || "—",
        })),
        branchName: branchSet.size > 0 ? Array.from(branchSet).join(", ") : c.branch?.name || "—",
        balance: Number(c.clientBalance),
        phone: c.phone,
        comment: c.comment,
      }
    })
    // Фильтр по статусу клиента (баг #109).
    .filter((r) => !selectedStatus || r.status === selectedStatus.label)
  balanceRows.sort((a, b) => b.balance - a.balance)
  const totalBalance = balanceRows.reduce((s, r) => s + r.balance, 0)

  // Ссылки вкладок сохраняют выбранные фильтры (филиал/статус), чтобы они не
  // сбрасывались при переключении вкладки (баг #107, #109).
  const carryParams = new URLSearchParams()
  if (selectedBranchId) carryParams.set("branch", selectedBranchId)
  if (selectedStatus) carryParams.set("status", selectedStatus.key)
  function tabHref(key: TabKey): string {
    const p = new URLSearchParams(carryParams)
    if (key !== "planned") p.set("tab", key)
    const qs = p.toString()
    return qs ? `/finance/debtors?${qs}` : "/finance/debtors"
  }
  const tabs: { key: TabKey; label: string; href: string }[] = [
    { key: "planned", label: "Плановый долг", href: tabHref("planned") },
    { key: "actual", label: "Фактический долг", href: tabHref("actual") },
    { key: "balance", label: "Баланс", href: tabHref("balance") },
  ]

  const tabDescription =
    tab === "planned"
      ? "Сколько клиенты должны доплатить по выписанным абонементам (сумма абонемента − оплачено) + неоплаченные разовые посещения."
      : tab === "actual"
        ? "Сколько клиент реально должен сейчас: отработано сверх оплаченного по абонементам + неоплаченные разовые посещения + перенесённый долг (импорт / закрытия с долгом)."
        : "Клиенты с положительным балансом — деньги родителя (предоплата/переплата), доступные к списанию за занятия и разовые посещения."

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 gap-y-2">
        <h1 className="text-2xl font-bold">Долг/Баланс</h1>
        <PageHelp pageKey="finance/debtors" />
        {tab === "balance" ? (
          <ReportExport
            title="Баланс клиентов"
            filename="clients-balance"
            columns={[
              { header: "Клиент", key: "name", width: 25 },
              { header: "Статус", key: "status", width: 14 },
              { header: "Ребёнок", key: "children", width: 25 },
              { header: "Филиал", key: "branchName", width: 18 },
              { header: "Баланс", key: "balance", width: 14 },
              { header: "Телефон", key: "phone", width: 18 },
              { header: "Комментарий", key: "comment", width: 30 },
            ]}
            rows={balanceRows.map((r) => ({
              name: r.name,
              status: r.status,
              children: r.wards.map((w) => w.name).filter((n) => n !== "—").join(", ") || "—",
              branchName: r.branchName,
              balance: r.balance,
              phone: r.phone || "—",
              comment: r.comment || "—",
            }))}
          />
        ) : (
          <ReportExport
            title={tab === "planned" ? "Должники (плановый долг)" : "Должники (фактический долг)"}
            filename={tab === "planned" ? "debtors-planned" : "debtors-actual"}
            columns={[
              { header: "Клиент", key: "name", width: 25 },
              { header: "Статус", key: "status", width: 14 },
              { header: "Ребёнок", key: "children", width: 25 },
              { header: "Филиал", key: "branchName", width: 18 },
              { header: "Направление", key: "directions", width: 25 },
              { header: "Долг", key: "debt", width: 14 },
              { header: "Телефон", key: "phone", width: 18 },
            ]}
            rows={rows.map((r) => ({
              name: r.name,
              status: r.status,
              children:
                Array.from(new Set(r.sources.map((s) => s.wardName).filter(Boolean))).join(", ") || "—",
              branchName: r.branchName,
              directions: r.directions,
              debt: r.debt,
              phone: r.phone || "—",
            }))}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {branchOptions.length > 1 && (
          <BranchSwitcher branches={branchOptions} selected={selectedBranchId} />
        )}
        <StatusFilter options={STATUS_OPTIONS} selected={selectedStatus?.key ?? null} />
      </div>

      <div className="border-b flex flex-wrap gap-1">
        {tabs.map((t) => {
          const active = t.key === tab
          return (
            <Link
              key={t.key}
              href={t.href}
              scroll={false}
              className={cn(
                "relative px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
      <p className="text-sm text-muted-foreground -mt-2">{tabDescription}</p>

      {tab === "balance" ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-green-50">
                <Wallet className="size-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Общий баланс</p>
                <p className="text-lg font-bold text-green-600">{formatMoney(totalBalance)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50">
                <Users className="size-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Клиентов с балансом</p>
                <p className="text-lg font-bold">{balanceRows.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-red-50">
                <AlertTriangle className="size-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Общий долг</p>
                <p className="text-lg font-bold text-red-600">{formatMoney(totalDebt)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-orange-50">
                <Users className="size-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Должников</p>
                <p className="text-lg font-bold">{rows.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-red-50">
                <AlertTriangle className="size-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Просрочено</p>
                <p className="text-lg font-bold text-red-600">{overdueCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "balance" ? (
        balanceRows.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
              Нет клиентов с балансом
            </CardContent>
          </Card>
        ) : (
          <StickyHScroll className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Ребёнок</TableHead>
                  <TableHead>Филиал</TableHead>
                  <TableHead className="text-right">Баланс</TableHead>
                  <TableHead>Телефон</TableHead>
                  <TableHead>Комментарий</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balanceRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/crm/clients/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-xs whitespace-nowrap", statusBadgeClass(r.status))}>
                        {r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground align-top">
                      {r.wards.length === 0 ? (
                        "—"
                      ) : (
                        <div className="space-y-0.5">
                          {r.wards.map((w) => (
                            <div key={w.id} className="text-xs">
                              <Link href={`/crm/wards/${w.id}`} className="text-primary hover:underline">
                                {w.name}
                              </Link>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.branchName}</TableCell>
                    <TableCell className="text-right font-medium text-green-600 tabular-nums">
                      {formatMoney(r.balance)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                    <TableCell>
                      {canEdit ? (
                        <EditableTextCell
                          initialValue={r.comment}
                          endpoint={{ url: `/api/clients/${r.id}`, field: "comment" }}
                          rows={1}
                          className="min-h-[32px] max-h-[50px] w-[200px] resize-none overflow-y-auto text-xs"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.comment || "—"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </StickyHScroll>
        )
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет должников
          </CardContent>
        </Card>
      ) : (
        <StickyHScroll className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Ребёнок</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Источник долга</TableHead>
                <TableHead className="text-right">Долг</TableHead>
                <TableHead>Обещанная дата</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/crm/clients/${r.id}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="outline" className={cn("text-xs whitespace-nowrap", statusBadgeClass(r.status))}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground align-top">
                    {r.sources.length === 0 ? (
                      "—"
                    ) : (
                      <div className="space-y-0.5">
                        {r.sources.map((s) => (
                          <div key={s.key} className="text-xs">
                            {s.wardId && s.wardName ? (
                              <Link href={`/crm/wards/${s.wardId}`} className="text-primary hover:underline">
                                {s.wardName}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground align-top">{r.branchName}</TableCell>
                  <TableCell className="text-muted-foreground align-top">
                    {r.sources.length === 0 ? (
                      <span>{r.directions}</span>
                    ) : (
                      <div className="space-y-0.5">
                        {r.sources.map((s) => (
                          <div key={s.key} className="flex items-baseline gap-2 text-xs">
                            <span className="text-foreground">{s.label}</span>
                            <span className="text-red-600 tabular-nums">−{formatMoney(s.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium text-red-600">{formatMoney(r.debt)}</TableCell>
                  <TableCell>
                    {canEdit ? (
                      <div className="flex items-center gap-2">
                        <EditableDateCell
                          initialValue={r.promisedIso}
                          endpoint={{ url: `/api/clients/${r.id}`, field: "promisedPaymentDate" }}
                        />
                        {r.isOverdue && <Badge variant="destructive" className="text-xs">просрочено</Badge>}
                      </div>
                    ) : r.promised ? (
                      <span className={r.isOverdue ? "font-medium text-red-600" : ""}>
                        {formatDate(r.promised)}
                        {r.isOverdue && <Badge variant="destructive" className="ml-2 text-xs">просрочено</Badge>}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                  <TableCell>
                    {canEdit ? (
                      <EditableTextCell
                        initialValue={r.comment}
                        endpoint={{ url: `/api/clients/${r.id}`, field: "comment" }}
                        rows={1}
                        className="min-h-[32px] max-h-[50px] w-[200px] resize-none overflow-y-auto text-xs"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.comment || "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </StickyHScroll>
      )}
    </div>
  )
}
