"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Input } from "@/components/ui/input"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { Search, ArrowDown, ArrowUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { truncateGroupName } from "@/lib/format-group"
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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })
}

function fmtMoney(n: number): string {
  return `${n.toLocaleString("ru-RU")} ₽`
}

function periodLabel(row: SubscriptionRow): string {
  const start = fmtDate(row.startDate)
  const endIso = row.endDate ?? row.expiresAt
  if (!endIso) return `с ${start}`
  return `${start} – ${fmtDate(endIso)}`
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

  const [query, setQuery] = useState(initialQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  function toggleSortByPeriod() {
    const next: "asc" | "desc" = initialSort === "asc" ? "desc" : "asc"
    const params = new URLSearchParams(searchParams.toString())
    // asc — дефолт; чтобы URL не пух, удаляем параметр для дефолта.
    if (next === "asc") params.delete("sort")
    else params.set("sort", "desc")
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
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ФИО ребёнка</TableHead>
                <TableHead>Направление</TableHead>
                <TableHead>Филиал</TableHead>
                <TableHead>Группа</TableHead>
                <TableHead className="text-right">Сумма к оплате</TableHead>
                <TableHead className="text-right">Оплачено</TableHead>
                <TableHead>
                  <button
                    type="button"
                    onClick={toggleSortByPeriod}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    Срок
                    {initialSort === "asc"
                      ? <ArrowUp className="size-3" />
                      : <ArrowDown className="size-3" />}
                  </button>
                </TableHead>
                <TableHead>Скидка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
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
        </div>
      )}
    </div>
  )
}
