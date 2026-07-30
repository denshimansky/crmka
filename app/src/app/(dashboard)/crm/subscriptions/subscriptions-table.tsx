"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  ResizableHead,
  RESIZABLE_TABLE_CLASS,
  useColumnWidths,
} from "@/components/resizable-columns"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { Search, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { cn } from "@/lib/utils"
import { truncateGroupName } from "@/lib/format-group"
import { useMoneyFormat } from "@/components/currency-provider"
import { RenewButton } from "./renew-button"

export type SubsTabKey = "active" | "pending" | "finished"

export interface SubsTab {
  value: SubsTabKey
  label: string
  count: number
}

export interface SubscriptionRow {
  id: string
  clientId: string
  wardName: string
  directionName: string
  branchName: string
  groupName: string
  finalAmount: number
  paidAmount: number
  startDate: string // ISO
  endDate: string | null // ISO
  expiresAt: string | null // ISO
  discountLabel: string
}

interface DictItem {
  id: string
  name: string
}

// Стартовые ширины столбцов (px) для ресайза (см. resizable-columns).
const DEFAULT_WIDTHS: Record<string, number> = {
  ward: 220,
  direction: 150,
  branch: 140,
  group: 160,
  amount: 140,
  paid: 130,
  period: 180,
  discount: 150,
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })
}

function periodLabel(row: SubscriptionRow): string {
  const start = fmtDate(row.startDate)
  const endIso = row.endDate ?? row.expiresAt
  if (!endIso) return `с ${start}`
  return `${start} – ${fmtDate(endIso)}`
}

// Ключи сортировки = столбцы таблицы. Сортировка клиентская (все строки уже
// загружены, см. take:500 в page.tsx — реальные объёмы < 200).
type SortKey =
  | "ward" | "direction" | "branch" | "group"
  | "amount" | "paid" | "period" | "discount"
type SortDir = "asc" | "desc"

/** Компаратор столбца (без учёта направления). Строки — по-русски (А-Я),
 *  деньги — по величине, «Срок» — по дате начала. */
function compareRows(a: SubscriptionRow, b: SubscriptionRow, key: SortKey): number {
  switch (key) {
    case "ward": return a.wardName.localeCompare(b.wardName, "ru")
    case "direction": return a.directionName.localeCompare(b.directionName, "ru")
    case "branch": return a.branchName.localeCompare(b.branchName, "ru")
    case "group": return a.groupName.localeCompare(b.groupName, "ru")
    case "amount": return a.finalAmount - b.finalAmount
    case "paid": return a.paidAmount - b.paidAmount
    case "period": return a.startDate.localeCompare(b.startDate)
    case "discount": return a.discountLabel.localeCompare(b.discountLabel, "ru")
  }
}

/** Кликабельный заголовок-сортировка. Стрелка вверх/вниз на активном столбце,
 *  бледная двойная стрелка на остальных — подсказка, что столбец сортируемый. */
function SortHeader({
  label, colKey, sortKey, sortDir, onSort, align = "left",
}: {
  label: string
  colKey: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  align?: "left" | "right"
}) {
  const active = sortKey === colKey
  return (
    <button
      type="button"
      onClick={() => onSort(colKey)}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-hidden hover:text-foreground",
        align === "right" && "w-full justify-end",
      )}
      title="Сортировать"
    >
      <span className="truncate">{label}</span>
      {active ? (
        sortDir === "asc"
          ? <ArrowUp className="size-3 shrink-0" />
          : <ArrowDown className="size-3 shrink-0" />
      ) : (
        <ArrowUpDown className="size-3 shrink-0 text-muted-foreground/40" />
      )}
    </button>
  )
}

export function SubscriptionsTable({
  tab,
  tabs,
  rows,
  branches,
  directions,
  initialQuery,
  initialBranchId,
  initialDirectionId,
  initialSort,
  canRenew,
}: {
  tab: SubsTabKey
  tabs: SubsTab[]
  rows: SubscriptionRow[]
  branches: DictItem[]
  directions: DictItem[]
  initialQuery: string
  initialBranchId: string
  initialDirectionId: string
  initialSort: "asc" | "desc"
  canRenew: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const fmtMoney = useMoneyFormat()

  const [query, setQuery] = useState(initialQuery)
  // Клиентская сортировка по любому столбцу. По умолчанию активен «Срок» в том
  // направлении, что пришло из URL, — это совпадает с порядком выборки на
  // сервере (orderBy startDate). Пока пользователь не кликнул по заголовку,
  // показываем строки в серверном порядке (`interacted=false`) — иначе при
  // гидратации строки с одинаковой датой начала (1-е число месяца) перескочат
  // из-за вторичного ключа и React ругнётся на несовпадение разметки.
  const [sortKey, setSortKey] = useState<SortKey>("period")
  const [sortDir, setSortDir] = useState<SortDir>(initialSort)
  const [interacted, setInteracted] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onSort(key: SortKey) {
    setInteracted(true)
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const sortedRows = useMemo(() => {
    if (!interacted) return rows
    const dir = sortDir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const c = compareRows(a, b, sortKey)
      // Вторичный ключ — ФИО, чтобы порядок был стабильным при равных значениях.
      return (c !== 0 ? c : a.wardName.localeCompare(b.wardName, "ru")) * dir
    })
  }, [rows, sortKey, sortDir, interacted])
  // Ширина столбцов: полоска-ручка на правом крае заголовка, localStorage
  // (общий модуль resizable-columns; столбцы всех вкладок одинаковые).
  const { widthOf, startResize } = useColumnWidths("subscriptions-colw", DEFAULT_WIDTHS)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      const trimmed = query.trim()
      if (trimmed) params.set("q", trimmed)
      else params.delete("q")
      const next = params.toString()
      if (next !== searchParams.toString()) {
        router.replace(`${pathname}?${next}`, { scroll: false })
      }
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  function setFilter(name: "branch" | "direction", value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== "all") params.set(name, value)
    else params.delete(name)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function buildTabHref(value: SubsTabKey) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", value)
    return `${pathname}?${params.toString()}`
  }

  const branchLabel = branches.find((b) => b.id === initialBranchId)?.name ?? "Все филиалы"
  const directionLabel = directions.find((d) => d.id === initialDirectionId)?.name ?? "Все направления"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 border-b">
          {tabs.map((t) => {
            const active = t.value === tab
            return (
              <Link
                key={t.value}
                href={buildTabHref(t.value)}
                scroll={false}
                className={cn(
                  "relative px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                <span className={cn("ml-1.5 text-xs", active ? "text-muted-foreground" : "text-muted-foreground/70")}>
                  {t.count}
                </span>
              </Link>
            )
          })}
        </div>
        {tab === "pending" && canRenew && (
          <RenewButton
            branchId={initialBranchId !== "all" ? initialBranchId : null}
            directionId={initialDirectionId !== "all" ? initialDirectionId : null}
          />
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по ФИО ребёнка, родителя или телефону…"
            className="pl-9"
          />
        </div>
        <Select
          value={initialBranchId}
          onValueChange={(v) => { if (v) setFilter("branch", v) }}
        >
          <SelectTrigger className="w-full">
            <span className="truncate">{branchLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все филиалы</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={initialDirectionId}
          onValueChange={(v) => { if (v) setFilter("direction", v) }}
        >
          <SelectTrigger className="w-full">
            <span className="truncate">{directionLabel}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все направления</SelectItem>
            {directions.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border bg-card p-12 text-sm text-muted-foreground">
          В этой категории пока пусто
        </div>
      ) : (
        <StickyHScroll className="rounded-lg border bg-card">
          <Table className={RESIZABLE_TABLE_CLASS}>
            <TableHeader>
              <TableRow>
                <ResizableHead id="ward" width={widthOf("ward")} onResizeStart={startResize}>
                  <SortHeader label="ФИО ребёнка" colKey="ward" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                </ResizableHead>
                <ResizableHead id="direction" width={widthOf("direction")} onResizeStart={startResize}>
                  <SortHeader label="Направление" colKey="direction" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                </ResizableHead>
                <ResizableHead id="branch" width={widthOf("branch")} onResizeStart={startResize}>
                  <SortHeader label="Филиал" colKey="branch" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                </ResizableHead>
                <ResizableHead id="group" width={widthOf("group")} onResizeStart={startResize}>
                  <SortHeader label="Группа" colKey="group" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                </ResizableHead>
                <ResizableHead id="amount" width={widthOf("amount")} onResizeStart={startResize} className="text-right">
                  <SortHeader label="Сумма к оплате" colKey="amount" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                </ResizableHead>
                <ResizableHead id="paid" width={widthOf("paid")} onResizeStart={startResize} className="text-right">
                  <SortHeader label="Оплачено" colKey="paid" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
                </ResizableHead>
                <ResizableHead id="period" width={widthOf("period")} onResizeStart={startResize}>
                  <SortHeader label="Срок" colKey="period" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                </ResizableHead>
                <ResizableHead id="discount" width={widthOf("discount")} onResizeStart={startResize}>
                  <SortHeader label="Скидка" colKey="discount" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
                </ResizableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40">
                  <TableCell className="font-medium">
                    <Link href={`/crm/clients/${r.clientId}?tab=subscriptions`} className="hover:underline">
                      {r.wardName}
                    </Link>
                  </TableCell>
                  <TableCell>{r.directionName}</TableCell>
                  <TableCell>{r.branchName}</TableCell>
                  <TableCell title={r.groupName || undefined}>{truncateGroupName(r.groupName)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.finalAmount)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.paidAmount)}</TableCell>
                  <TableCell>{periodLabel(r)}</TableCell>
                  <TableCell>{r.discountLabel}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </StickyHScroll>
      )}
    </div>
  )
}
