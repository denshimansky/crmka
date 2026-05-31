"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table"
import { Search, Copy, Upload, RotateCcw } from "lucide-react"
import { SortableTableHead } from "@/components/sortable-table-head"
import { useTablePrefs } from "@/hooks/use-table-prefs"
import { formatWardName } from "@/lib/format-name"

// --- Types ---

interface Ward {
  id: string
  firstName: string
  lastName: string | null
}

interface ClientRow {
  id: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  segment: string
  clientBalance: string // Decimal serialized as string
  funnelStatus: string
  clientStatus: string | null
  wards: Ward[]
  branch: { id: string; name: string } | null
}

// --- Labels and colors ---

const SEGMENT_LABELS: Record<string, string> = {
  new_client: "Новый",
  standard: "Стандарт",
  regular: "Постоянный",
  vip: "VIP",
}

const SEGMENT_ORDER: Record<string, number> = {
  new_client: 1,
  standard: 2,
  regular: 3,
  vip: 4,
}

const SEGMENT_COLORS: Record<string, string> = {
  new_client: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  standard: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  regular: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  vip: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
}

const FUNNEL_LABELS: Record<string, string> = {
  new: "Новый лид",
  trial_scheduled: "Пробное записано",
  trial_attended: "Был на пробном",
  awaiting_payment: "Ждём оплату",
  active_client: "Активный",
  potential: "Потенциальный",
  non_target: "Нецелевой",
  blacklisted: "Чёрный список",
  archived: "Архив",
}

const CLIENT_STATUS_LABELS: Record<string, string> = {
  active: "Активный",
  upsell: "Допродажа",
  churned: "Выбывший",
  returning: "Возврат",
  archived: "Архив",
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function getStatusBadge(client: ClientRow) {
  if (client.clientStatus) {
    const label = CLIENT_STATUS_LABELS[client.clientStatus] || client.clientStatus
    const isActive = client.clientStatus === "active"
    const isChurned = client.clientStatus === "churned"
    return (
      <Badge variant={isChurned ? "destructive" : isActive ? "default" : "secondary"}>
        {label}
      </Badge>
    )
  }
  // Lead — show funnel status
  const label = FUNNEL_LABELS[client.funnelStatus] || client.funnelStatus
  return (
    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">
      {label}
    </span>
  )
}

type TabKey = "all" | "active" | "upsell" | "churned"

const TABS: { key: TabKey; label: string }[] = [
  { key: "active", label: "Активные" },
  { key: "upsell", label: "Допродажа" },
  { key: "churned", label: "Выбывшие" },
  { key: "all", label: "Все" },
]

// --- Колонки ---

type SortVal = string | number | null

interface ColumnDef {
  key: string
  label: string
  align?: "left" | "right" | "center"
  sortable?: boolean
  getValue: (c: ClientRow) => SortVal
  render: (c: ClientRow) => React.ReactNode
}

const COLUMNS: ColumnDef[] = [
  {
    key: "name",
    label: "ФИО",
    getValue: (c) => [c.lastName, c.firstName].filter(Boolean).join(" ").toLowerCase() || null,
    render: (c) => {
      const fullName = [c.lastName, c.firstName].filter(Boolean).join(" ") || "—"
      return (
        <Link
          href={`/crm/clients/${c.id}`}
          className="font-medium hover:underline"
        >
          {fullName}
        </Link>
      )
    },
  },
  {
    key: "phone",
    label: "Телефон",
    getValue: (c) => c.phone?.toLowerCase() || null,
    render: (c) => (
      <span className="text-muted-foreground">{c.phone || "—"}</span>
    ),
  },
  {
    key: "wards",
    label: "Дети",
    getValue: (c) => c.wards.length,
    render: (c) => {
      const wardNames = c.wards
        .map((w) => formatWardName(w, ""))
        .filter(Boolean)
        .join(", ")
      return (
        <span className="text-sm text-muted-foreground">
          {c.wards.length > 0 ? `${c.wards.length} · ${wardNames}` : "—"}
        </span>
      )
    },
  },
  {
    key: "segment",
    label: "Сегмент",
    getValue: (c) => SEGMENT_ORDER[c.segment] ?? 99,
    render: (c) => (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEGMENT_COLORS[c.segment] || ""}`}
      >
        {SEGMENT_LABELS[c.segment] || c.segment}
      </span>
    ),
  },
  {
    key: "balance",
    label: "Баланс",
    align: "right",
    getValue: (c) => Number(c.clientBalance),
    render: (c) => {
      const balance = Number(c.clientBalance)
      return (
        <span
          className={`font-medium ${
            balance > 0
              ? "text-green-600"
              : balance < 0
                ? "text-red-600"
                : "text-muted-foreground"
          }`}
        >
          {balance === 0 ? "—" : formatMoney(balance)}
        </span>
      )
    },
  },
  {
    key: "status",
    label: "Статус",
    getValue: (c) => (c.clientStatus || c.funnelStatus || "").toLowerCase(),
    render: (c) => getStatusBadge(c),
  },
]

const DEFAULT_ORDER = COLUMNS.map((c) => c.key)
const STORAGE_KEY = "table-prefs:clients"

export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  const [tab, setTab] = useState<TabKey>("active")
  const [search, setSearch] = useState("")

  const { columnOrder, sortBy, sortDir, handleSortClick, moveColumn, resetPrefs } =
    useTablePrefs({ storageKey: STORAGE_KEY, defaultOrder: DEFAULT_ORDER })

  const orderedCols = useMemo(
    () =>
      columnOrder
        .map((k) => COLUMNS.find((c) => c.key === k))
        .filter((c): c is ColumnDef => Boolean(c)),
    [columnOrder],
  )

  const filtered = useMemo(() => {
    let result = clients

    // Tab filter
    if (tab === "active") {
      result = result.filter((c) => c.clientStatus === "active" || !c.clientStatus)
    } else if (tab === "upsell") {
      result = result.filter((c) => c.clientStatus === "upsell")
    } else if (tab === "churned") {
      result = result.filter((c) => c.clientStatus === "churned" || c.clientStatus === "archived")
    }

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((c) => {
        const fullName = [c.lastName, c.firstName].filter(Boolean).join(" ").toLowerCase()
        const phone = (c.phone || "").toLowerCase()
        return fullName.includes(q) || phone.includes(q)
      })
    }

    // Sort
    if (sortBy) {
      const col = COLUMNS.find((c) => c.key === sortBy)
      if (col) {
        result = [...result].sort((a, b) => {
          const av = col.getValue(a)
          const bv = col.getValue(b)
          if (av == null && bv == null) return 0
          if (av == null) return 1
          if (bv == null) return -1
          if (av < bv) return sortDir === "asc" ? -1 : 1
          if (av > bv) return sortDir === "asc" ? 1 : -1
          return 0
        })
      }
    }

    return result
  }, [clients, tab, search, sortBy, sortDir])

  return (
    <>
      <div className="flex items-center gap-4">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Button
              key={t.key}
              variant={tab === t.key ? "default" : "outline"}
              size="sm"
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск по имени, телефону..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={resetPrefs}
            title="Вернуть исходный порядок столбцов и сбросить сортировку"
          >
            <RotateCcw className="mr-1 size-3.5" />
            Сбросить
          </Button>
          <Button variant="outline" size="sm" render={<Link href="/crm/duplicates" />}>
            <Copy className="mr-2 size-4" />
            Дубликаты
          </Button>
          <Button variant="outline" size="sm" render={<Link href="/crm/import" />}>
            <Upload className="mr-2 size-4" />
            Импорт
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border p-12 text-center text-muted-foreground">
          {clients.length === 0
            ? "Нет клиентов. Добавьте первого клиента или импортируйте базу."
            : "Нет клиентов по заданным фильтрам."}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {orderedCols.map((col) => (
                  <SortableTableHead
                    key={col.key}
                    columnKey={col.key}
                    label={col.label}
                    activeSortKey={sortBy}
                    sortDir={sortDir}
                    sortable={col.sortable !== false}
                    onSortClick={handleSortClick}
                    onMove={moveColumn}
                    align={col.align}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((client) => (
                <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50">
                  {orderedCols.map((col) => (
                    <TableCell
                      key={col.key}
                      className={col.align === "right" ? "text-right" : undefined}
                    >
                      {col.render(client)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
