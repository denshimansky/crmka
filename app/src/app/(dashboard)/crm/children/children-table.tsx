"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Search, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { EditableTextCell } from "../_components/editable-cell"

export type ChildState =
  | "lead"
  | "potential"
  | "nontarget"
  | "active"
  | "churned"
  | "archived"
  | "blacklist"

export interface ChildRow {
  id: string
  firstName: string
  lastName: string | null
  birthDate: string | null
  parentId: string
  parentName: string
  parentPhone: string | null
  parentComment: string | null
  branchId: string | null
  branchName: string | null
  state: ChildState
}

export interface BranchOption {
  id: string
  name: string
}

const STATE_LABEL: Record<ChildState, string> = {
  lead: "Лид",
  potential: "Потенциал",
  nontarget: "Нецелевой",
  active: "Активный",
  churned: "Выбывший",
  archived: "Архив",
  blacklist: "Чёрный список",
}

// Палитра для бейджей состояния — единая с остальной CRM.
const STATE_BADGE: Record<ChildState, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  lead: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  potential: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  nontarget: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  churned: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  archived: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  blacklist: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
}

// По умолчанию активные/целевые состояния включены; «мусорные» (архив/ЧС/нецелевой) — скрыты.
const DEFAULT_STATES: ChildState[] = ["lead", "potential", "active", "churned"]

const STATE_ORDER: ChildState[] = [
  "active",
  "lead",
  "potential",
  "churned",
  "nontarget",
  "archived",
  "blacklist",
]

function wardFullName(r: { firstName: string; lastName: string | null }): string {
  return [r.firstName, r.lastName].filter(Boolean).join(" ") || "Без имени"
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU")
}

function ageInYears(iso: string | null): number | null {
  if (!iso) return null
  const birth = new Date(iso)
  const now = new Date()
  let years = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--
  if (years < 0) return null
  return years
}

function ageLabel(iso: string | null): string {
  const years = ageInYears(iso)
  if (years === null) return "—"
  const mod10 = years % 10
  const mod100 = years % 100
  if (mod100 >= 11 && mod100 <= 19) return `${years} лет`
  if (mod10 === 1) return `${years} год`
  if (mod10 >= 2 && mod10 <= 4) return `${years} года`
  return `${years} лет`
}

// ── Сортировка ──
type SortKey = "state" | "child" | "parent" | "phone" | "age" | "birthDate" | "branch"
type SortDir = "asc" | "desc"

function compareByKey(a: ChildRow, b: ChildRow, key: SortKey): number {
  switch (key) {
    case "state":
      return STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
    case "child":
      return wardFullName(a).localeCompare(wardFullName(b), "ru")
    case "parent":
      return a.parentName.localeCompare(b.parentName, "ru")
    case "phone":
      return (a.parentPhone || "").localeCompare(b.parentPhone || "", "ru")
    case "age": {
      const ya = ageInYears(a.birthDate)
      const yb = ageInYears(b.birthDate)
      if (ya === null && yb === null) return 0
      if (ya === null) return 1
      if (yb === null) return -1
      return ya - yb
    }
    case "birthDate":
      return (a.birthDate || "").localeCompare(b.birthDate || "")
    case "branch":
      return (a.branchName || "").localeCompare(b.branchName || "", "ru")
  }
}

export function ChildrenTable({
  rows,
  branches,
}: {
  rows: ChildRow[]
  branches: BranchOption[]
}) {
  const [query, setQuery] = useState("")
  const [ageFrom, setAgeFrom] = useState("")
  const [ageTo, setAgeTo] = useState("")
  const [states, setStates] = useState<Set<ChildState>>(new Set(DEFAULT_STATES))
  const [branchIds, setBranchIds] = useState<Set<string>>(new Set()) // пусто = все
  const [sortKey, setSortKey] = useState<SortKey>("child")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  function toggleState(s: ChildState) {
    setStates((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function toggleBranch(id: string) {
    setBranchIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function setSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const ageMin = ageFrom === "" ? null : Number(ageFrom)
    const ageMax = ageTo === "" ? null : Number(ageTo)
    return rows.filter((r) => {
      if (!states.has(r.state)) return false
      if (branchIds.size > 0 && (!r.branchId || !branchIds.has(r.branchId))) return false
      if (ageMin !== null || ageMax !== null) {
        const years = ageInYears(r.birthDate)
        if (years === null) return false
        if (ageMin !== null && years < ageMin) return false
        if (ageMax !== null && years > ageMax) return false
      }
      if (q) {
        const childName = wardFullName(r).toLowerCase()
        const parentName = r.parentName.toLowerCase()
        const phone = (r.parentPhone || "").toLowerCase()
        if (!childName.includes(q) && !parentName.includes(q) && !phone.includes(q)) {
          return false
        }
      }
      return true
    })
  }, [rows, states, branchIds, ageFrom, ageTo, query])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      const cmp = compareByKey(a, b, sortKey)
      return sortDir === "asc" ? cmp : -cmp
    })
    return copy
  }, [filtered, sortKey, sortDir])

  function sortIcon(key: SortKey) {
    if (sortKey !== key) return <ArrowUpDown className="size-3 text-muted-foreground/50" />
    return sortDir === "asc" ? (
      <ArrowUp className="size-3" />
    ) : (
      <ArrowDown className="size-3" />
    )
  }

  function sortableHead(key: SortKey, label: string, extraClass = "") {
    return (
      <TableHead className={extraClass}>
        <button
          type="button"
          onClick={() => setSort(key)}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          {label}
          {sortIcon(key)}
        </button>
      </TableHead>
    )
  }

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по ФИО ребёнка, родителя или телефону..."
          className="pl-9"
        />
      </div>

      <div className="space-y-2 rounded-lg border bg-card p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Состояние:</span>
          {STATE_ORDER.map((s) => {
            const on = states.has(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleState(s)}
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition ${
                  on
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                {STATE_LABEL[s]}
              </button>
            )
          })}
        </div>

        {branches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Филиал:</span>
            {branches.map((b) => {
              const on = branchIds.has(b.id)
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => toggleBranch(b.id)}
                  className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition ${
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {b.name}
                </button>
              )
            })}
            {branchIds.size > 0 && (
              <button
                type="button"
                onClick={() => setBranchIds(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                сбросить
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Возраст:</span>
          <Input
            type="number"
            min={0}
            max={99}
            placeholder="от"
            value={ageFrom}
            onChange={(e) => setAgeFrom(e.target.value)}
            className="h-8 w-20"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="number"
            min={0}
            max={99}
            placeholder="до"
            value={ageTo}
            onChange={(e) => setAgeTo(e.target.value)}
            className="h-8 w-20"
          />
          {(ageFrom !== "" || ageTo !== "") && (
            <button
              type="button"
              onClick={() => {
                setAgeFrom("")
                setAgeTo("")
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              сбросить
            </button>
          )}
          <span className="ml-auto text-muted-foreground">Всего: {sorted.length}</span>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border bg-card p-12 text-sm text-muted-foreground">
          Нет подопечных, подходящих под фильтры
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {sortableHead("state", "Состояние")}
                {sortableHead("child", "Ребёнок")}
                {sortableHead("parent", "Родитель")}
                {sortableHead("phone", "Телефон")}
                {sortableHead("age", "Возраст")}
                {sortableHead("birthDate", "Дата рождения")}
                {sortableHead("branch", "Филиал посещения")}
                <TableHead>Комментарий</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE[r.state]}`}
                    >
                      {STATE_LABEL[r.state]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link href={`/crm/wards/${r.id}`} className="font-medium hover:underline">
                      {wardFullName(r)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/crm/clients/${r.parentId}`} className="hover:underline">
                      {r.parentName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.parentPhone || "—"}</TableCell>
                  <TableCell className="text-sm">{ageLabel(r.birthDate)}</TableCell>
                  <TableCell className="text-sm">{fmtDate(r.birthDate)}</TableCell>
                  <TableCell className="text-sm">{r.branchName || "—"}</TableCell>
                  <TableCell>
                    <EditableTextCell
                      initialValue={r.parentComment}
                      endpoint={{ url: `/api/clients/${r.parentId}`, field: "comment" }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
