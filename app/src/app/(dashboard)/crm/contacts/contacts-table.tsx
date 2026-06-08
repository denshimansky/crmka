"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { CreateApplicationDialog } from "../_components/create-application-dialog"
import { formatWardName } from "@/lib/format-name"
import { truncateGroupName } from "@/lib/format-group"
import {
  EditableDateCell,
  EditableSelectCell,
  EditableTextCell,
} from "../_components/editable-cell"

export type ContactsTabKey =
  | "leads"
  | "potential"
  | "nontarget"
  | "active"
  | "churned"
  | "archived"
  | "blacklist"
  | "all"

type WardLite = { id: string; firstName: string; lastName: string | null; birthDate: string | null }

export interface ContactRow {
  id: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  socialLink: string | null
  segment: string
  channelName: string | null
  branchName: string | null
  funnelStatus: string
  clientStatus: string | null
  comment: string | null
  nextContactDate: string | null
  assignedTo: string | null
  createdAt: string
  wards: WardLite[]
  activeSubscription?: {
    directionName: string
    groupName: string
    branchName: string | null
    instructor: { id: string | null; name: string }
  } | null
  hasActiveSubscription: boolean
  hasActiveApplication: boolean
}

interface EmployeeOption {
  id: string
  firstName: string | null
  lastName: string | null
}

const SEGMENT_LABELS: Record<string, string> = {
  new_client: "Новый",
  standard: "Стандарт",
  regular: "Постоянный",
  vip: "VIP",
}

function fullName(r: { firstName: string | null; lastName: string | null }): string {
  return [r.lastName, r.firstName].filter(Boolean).join(" ") || "Без имени"
}

function wardsLabel(wards: WardLite[]): string {
  if (!wards.length) return "—"
  return wards.map((w) => formatWardName(w, "—")).join(", ")
}

function firstWardBirth(wards: WardLite[]): string {
  const bd = wards.find((w) => w.birthDate)?.birthDate
  if (!bd) return "—"
  return new Date(bd).toLocaleDateString("ru-RU")
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("ru-RU")
}

function stateLabel(r: ContactRow): string {
  if (r.funnelStatus === "archived") return "Архив"
  if (r.funnelStatus === "blacklisted") return "Чёрный список"
  if (r.clientStatus === "active") return "Активный"
  if (r.clientStatus === "churned") return "Выбывший"
  if (r.funnelStatus === "non_target") return "Нецелевой"
  if (r.funnelStatus === "potential") return "Потенциал"
  return "Лид"
}

export function ContactsTable({
  tab,
  rows,
  employees,
  initialQuery = "",
}: {
  tab: ContactsTabKey
  rows: ContactRow[]
  employees: EmployeeOption[]
  initialQuery?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(initialQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced sync ввода с URL ?q=… — серверный поиск по всей базе.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      const trimmed = query.trim()
      if (trimmed) params.set("q", trimmed)
      else params.delete("q")
      const next = params.toString()
      const current = searchParams.toString()
      if (next !== current) router.replace(`${pathname}?${next}`, { scroll: false })
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const employeeOptions = useMemo(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: [e.lastName, e.firstName].filter(Boolean).join(" ") || "Без имени",
      })),
    [employees],
  )

  // Сервер уже отфильтровал по q — клиентский filter не нужен.
  const visibleRows = rows

  const searchBar = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск по ФИО родителя или ребёнка..."
        className="pl-9"
      />
    </div>
  )

  if (rows.length === 0) {
    return (
      <>
        {searchBar}
        <div className="flex items-center justify-center rounded-lg border bg-card p-12 text-sm text-muted-foreground">
          В этой категории пока пусто
        </div>
      </>
    )
  }

  if (visibleRows.length === 0) {
    return (
      <>
        {searchBar}
        <div className="flex items-center justify-center rounded-lg border bg-card p-12 text-sm text-muted-foreground">
          Никто не найден по запросу «{query}»
        </div>
      </>
    )
  }

  return (
    <>
    {searchBar}
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {tab === "leads" && <TableHead className="w-[40px]"></TableHead>}
            {tab === "potential" && <TableHead className="w-[40px]"></TableHead>}
            {tab === "all" && <TableHead>Состояние</TableHead>}
            <TableHead>ФИО родителя</TableHead>
            <TableHead>Телефон</TableHead>
            <TableHead>Соцсети</TableHead>
            {(tab === "churned" || tab === "archived" || tab === "blacklist") && (
              <TableHead>Дата рождения</TableHead>
            )}
            {(tab === "leads" ||
              tab === "potential" ||
              tab === "nontarget" ||
              tab === "active" ||
              tab === "all") && <TableHead>Дети</TableHead>}
            {tab === "active" && <TableHead>Сегмент</TableHead>}
            {tab === "leads" && <TableHead>Канал</TableHead>}
            {tab === "active" && <TableHead>Филиал</TableHead>}
            {tab === "active" && <TableHead>Направление</TableHead>}
            {tab === "active" && <TableHead>Группа</TableHead>}
            {tab === "active" && <TableHead>Педагог</TableHead>}
            {tab === "leads" && <TableHead>Дата создания</TableHead>}
            {tab === "leads" && <TableHead>След. связь</TableHead>}
            {(tab === "leads" || tab === "potential" || tab === "nontarget" || tab === "active" || tab === "all") && (
              <TableHead>Комментарий</TableHead>
            )}
            {(tab === "leads" || tab === "potential" || tab === "nontarget" || tab === "active") && (
              <TableHead>Ответственный</TableHead>
            )}
            {(tab === "active" || tab === "churned") && <TableHead className="w-[40px]"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((r) => (
            <TableRow key={r.id}>
              {(tab === "leads" || tab === "potential") && (
                <TableCell>
                  <CreateApplicationDialog clientId={r.id} wards={r.wards} variant="ghost" size="sm" triggerLabel="" />
                </TableCell>
              )}
              {tab === "all" && <TableCell className="text-xs">{stateLabel(r)}</TableCell>}
              <TableCell>
                <Link href={`/crm/clients/${r.id}`} className="font-medium hover:underline">
                  {fullName(r)}
                </Link>
                {r.hasActiveApplication && (
                  <Link
                    href="/crm/sales?tab=application"
                    title="У клиента есть активная заявка"
                    className="ml-2 inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    Заявка
                  </Link>
                )}
              </TableCell>
              <TableCell className="text-sm">{r.phone || "—"}</TableCell>
              <TableCell className="text-sm">
                {r.socialLink ? (
                  <a
                    href={r.socialLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline truncate max-w-[140px] inline-block"
                  >
                    {r.socialLink}
                  </a>
                ) : (
                  "—"
                )}
              </TableCell>
              {(tab === "churned" || tab === "archived" || tab === "blacklist") && (
                <TableCell className="text-sm">{firstWardBirth(r.wards)}</TableCell>
              )}
              {(tab === "leads" ||
                tab === "potential" ||
                tab === "nontarget" ||
                tab === "active" ||
                tab === "all") && (
                <TableCell className="text-sm max-w-[200px] truncate">{wardsLabel(r.wards)}</TableCell>
              )}
              {tab === "active" && <TableCell className="text-xs">{SEGMENT_LABELS[r.segment] || "—"}</TableCell>}
              {tab === "leads" && <TableCell className="text-sm">{r.channelName || "—"}</TableCell>}
              {tab === "active" && <TableCell className="text-sm">{r.branchName || "—"}</TableCell>}
              {tab === "active" && (
                <TableCell className="text-sm">{r.activeSubscription?.directionName || "—"}</TableCell>
              )}
              {tab === "active" && (
                <TableCell className="text-sm" title={r.activeSubscription?.groupName || undefined}>
                  {truncateGroupName(r.activeSubscription?.groupName)}
                </TableCell>
              )}
              {tab === "active" && (
                <TableCell className="text-sm">{r.activeSubscription?.instructor.name || "—"}</TableCell>
              )}
              {tab === "leads" && <TableCell className="text-sm">{fmtDate(r.createdAt)}</TableCell>}
              {tab === "leads" && (
                <TableCell>
                  <EditableDateCell
                    initialValue={r.nextContactDate ? r.nextContactDate.slice(0, 10) : ""}
                    endpoint={{ url: `/api/clients/${r.id}`, field: "nextContactDate" }}
                  />
                </TableCell>
              )}
              {(tab === "leads" || tab === "potential" || tab === "nontarget" || tab === "active" || tab === "all") && (
                <TableCell>
                  <EditableTextCell
                    initialValue={r.comment}
                    endpoint={{ url: `/api/clients/${r.id}`, field: "comment" }}
                  />
                </TableCell>
              )}
              {(tab === "leads" || tab === "potential" || tab === "nontarget" || tab === "active") && (
                <TableCell>
                  <EditableSelectCell
                    initialValue={r.assignedTo}
                    options={employeeOptions}
                    endpoint={{ url: `/api/clients/${r.id}`, field: "assignedTo" }}
                    placeholder="Не назначен"
                  />
                </TableCell>
              )}
              {(tab === "active" || tab === "churned") && (
                <TableCell>
                  <CreateApplicationDialog clientId={r.id} wards={r.wards} variant="ghost" size="sm" triggerLabel="" />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    </>
  )
}
