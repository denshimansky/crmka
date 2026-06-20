import { getSession, getBranchScope } from "@/lib/session"
import { db } from "@/lib/db"
import { scopeClientByBranch } from "@/lib/client-segments"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertTriangle, Users } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { PageHelp } from "@/components/page-help"
import { ReportExport } from "@/components/report-export"
import { EditableDateCell, EditableTextCell } from "../../crm/_components/editable-cell"

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function formatDate(date: Date | null): string {
  if (!date) return "—"
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

type TabKey = "planned" | "actual"

export default async function DebtorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await getSession()
  const tenantId = session.user.tenantId
  const scope = await getBranchScope()
  const clientScope = scopeClientByBranch(scope)
  // Редактировать обещанную дату/комментарий может любая роль, кроме «только чтение».
  const canEdit = session.user.role !== "readonly"

  const sp = await searchParams
  const tab: TabKey = sp.tab === "actual" ? "actual" : "planned"

  // Подтягиваем клиентов, у которых ЕСТЬ потенциальный долг (любого типа):
  //   - есть не-отчисленный абонемент с остатком к оплате (balance>0) — кандидат
  //     в плановый долг;
  //   - ИЛИ есть не-отчисленный абонемент с накоплёнными списаниями (chargedAmount>0) —
  //     кандидат в фактический долг (он мог уже оплатить часть, но списано больше).
  // Дальше отфильтруем уже в JS по выбранному tab'у.
  const candidates = await db.client.findMany({
    where: {
      tenantId,
      deletedAt: null,
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
        // Перенесённый/импортный долг: отрицательный баланс клиента, не привязанный
        // к абонементу (долг с закрытий или после импорта). Виден во вкладке
        // «Фактический долг».
        { clientBalance: { lt: 0 } },
      ],
      ...(Object.keys(clientScope).length > 0 ? clientScope : {}),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      clientBalance: true,
      promisedPaymentDate: true,
      comment: true,
      phone: true,
      branch: { select: { name: true } },
      subscriptions: {
        where: {
          deletedAt: null,
          status: { not: "withdrawn" },
        },
        select: {
          id: true,
          status: true,
          direction: { select: { name: true } },
          group: { select: { branch: { select: { name: true } } } },
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

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  type Source = { key: string; label: string; amount: number; wardId: string | null; wardName: string | null }
  type Row = {
    id: string
    name: string
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

  const rows: Row[] = []
  for (const c of candidates) {
    const name = [c.lastName, c.firstName].filter(Boolean).join(" ") || "Без имени"
    const promised = c.promisedPaymentDate
    const isOverdue = !!(promised && promised < today)
    const directionsSet = new Set<string>()
    // Филиал долга берём из групп абонементов, формирующих долг (поле branchId
    // у самого клиента обычно пустое). Фоллбэк — филиал клиента.
    const branchSet = new Set<string>()

    const sources: Source[] = []
    let debt = 0
    for (const sub of c.subscriptions) {
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

    // Перенесённый/импортный долг (отрицательный баланс клиента, не привязан к
    // абонементу) — только во «Фактическом»: это реально недоплаченные деньги.
    // В «Плановый» (доплата по абонементам) он не входит.
    if (tab === "actual") {
      const carried = -Number(c.clientBalance)
      if (carried > 0) {
        sources.push({ key: "carried", label: "Перенесённый долг (импорт/закрытие)", amount: carried, wardId: null, wardName: null })
        debt += carried
      }
    }

    if (debt <= 0) continue
    sources.sort((a, b) => b.amount - a.amount)
    rows.push({
      id: c.id,
      name,
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
  rows.sort((a, b) => b.debt - a.debt)

  const totalDebt = rows.reduce((s, r) => s + r.debt, 0)
  const overdueCount = rows.filter((r) => r.isOverdue).length

  const tabs: { key: TabKey; label: string; href: string }[] = [
    { key: "planned", label: "Плановый долг", href: "/finance/debtors" },
    { key: "actual", label: "Фактический долг", href: "/finance/debtors?tab=actual" },
  ]

  const tabDescription =
    tab === "planned"
      ? "Сколько клиенты должны доплатить по выписанным абонементам (finalAmount − оплачено)."
      : "Сколько клиент реально должен сейчас: отработано сверх оплаченного по абонементам + перенесённый долг (импорт / закрытия с долгом)."

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Должники</h1>
        <PageHelp pageKey="finance/debtors" />
        <ReportExport
          title={tab === "planned" ? "Должники (плановый долг)" : "Должники (фактический долг)"}
          filename={tab === "planned" ? "debtors-planned" : "debtors-actual"}
          columns={[
            { header: "Клиент", key: "name", width: 25 },
            { header: "Ребёнок", key: "children", width: 25 },
            { header: "Филиал", key: "branchName", width: 18 },
            { header: "Направление", key: "directions", width: 25 },
            { header: "Долг", key: "debt", width: 14 },
            { header: "Телефон", key: "phone", width: 18 },
          ]}
          rows={rows.map((r) => ({
            name: r.name,
            children:
              Array.from(new Set(r.sources.map((s) => s.wardName).filter(Boolean))).join(", ") || "—",
            branchName: r.branchName,
            directions: r.directions,
            debt: r.debt,
            phone: r.phone || "—",
          }))}
        />
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

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет должников
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клиент</TableHead>
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
                        className="min-h-[32px] w-[200px] resize-none text-xs"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.comment || "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
