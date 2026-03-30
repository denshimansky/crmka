"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Search } from "lucide-react"

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

type TabKey = "all" | "active" | "lead" | "churned"

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "active", label: "Активные" },
  { key: "lead", label: "Лиды" },
  { key: "churned", label: "Выбывшие" },
]

export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  const [tab, setTab] = useState<TabKey>("all")
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    let result = clients

    // Tab filter
    if (tab === "active") {
      result = result.filter((c) => c.clientStatus === "active")
    } else if (tab === "lead") {
      result = result.filter(
        (c) => !c.clientStatus && c.funnelStatus !== "active_client" && c.funnelStatus !== "archived"
      )
    } else if (tab === "churned") {
      result = result.filter((c) => c.clientStatus === "churned")
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

    return result
  }, [clients, tab, search])

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
                <TableHead>ФИО</TableHead>
                <TableHead>Телефон</TableHead>
                <TableHead>Дети</TableHead>
                <TableHead>Сегмент</TableHead>
                <TableHead className="text-right">Баланс</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((client) => {
                const fullName = [client.lastName, client.firstName]
                  .filter(Boolean)
                  .join(" ") || "—"
                const balance = Number(client.clientBalance)
                const wardNames = client.wards
                  .map((w) => [w.firstName, w.lastName].filter(Boolean).join(" "))
                  .join(", ")
                const wardCount = client.wards.length

                return (
                  <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link
                        href={`/crm/clients/${client.id}`}
                        className="font-medium hover:underline"
                      >
                        {fullName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.phone || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {wardCount > 0
                        ? `${wardCount} · ${wardNames}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEGMENT_COLORS[client.segment] || ""}`}
                      >
                        {SEGMENT_LABELS[client.segment] || client.segment}
                      </span>
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        balance > 0
                          ? "text-green-600"
                          : balance < 0
                            ? "text-red-600"
                            : "text-muted-foreground"
                      }`}
                    >
                      {balance === 0 ? "—" : formatMoney(balance)}
                    </TableCell>
                    <TableCell>{getStatusBadge(client)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
