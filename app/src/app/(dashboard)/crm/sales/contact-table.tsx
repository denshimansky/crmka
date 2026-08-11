"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { EditableDateCell, EditableTextCell } from "../_components/editable-cell"
import { RemoveFromContactButton } from "./remove-from-contact-button"

// Ярлыки статусов совпадают с табами «Клиенты» (/crm/contacts) и подсказкой дублей.
const STATUS_LABELS: Record<string, string> = {
  new: "Лид",
  trial_scheduled: "Пробное записано",
  trial_attended: "Пробное пройдено",
  awaiting_payment: "Ожидание оплаты",
  active_client: "Активный",
  potential: "Потенциал",
  non_target: "Нецелевой",
  blacklisted: "Чёрный список",
  archived: "Архив",
}

export interface ContactWard {
  id: string
  name: string
}

export interface ContactRow {
  clientId: string
  name: string
  phone: string | null
  funnelStatus: string
  clientStatus: string | null
  nextContactDate: string // ISO
  comment: string | null
  wards: ContactWard[]
  assigneeName: string | null
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function statusLabel(funnelStatus: string, clientStatus: string | null): string {
  if (clientStatus === "churned") return "Выбывший"
  return STATUS_LABELS[funnelStatus] ?? funnelStatus
}

/** Вкладка «Связь» раздела «Продажи»: клиенты/лиды с назначенной датой связи.
 *  «След. связь» и «Комментарий» редактируются инлайн (PATCH /api/clients/[id]),
 *  кроме роли «только чтение». Очистка даты связи убирает клиента из вкладки.
 *
 *  Строка поиска и селектор филиала — как на остальных вкладках «Продаж» (см.
 *  searchBar в sales-table.tsx). Поиск клиентский (по ФИО родителя/ребёнка),
 *  фильтр по филиалу серверный (?branchId=... переживает переключение вкладок). */
export function ContactTable({
  rows,
  canEdit,
  branches,
  branchId,
}: {
  rows: ContactRow[]
  canEdit: boolean
  branches: { id: string; name: string }[]
  branchId: string | null
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")

  const showBranchFilter = branches.length > 1
  function setBranch(value: string) {
    const params = new URLSearchParams(window.location.search)
    if (value === "all") params.delete("branchId")
    else params.set("branchId", value)
    router.push(`?${params.toString()}`)
  }

  // Поиск-по-токенам: каждое слово запроса ищется в склейке «ФИО родителя + ФИО
  // детей» — так же, как в SalesTable (в строке лежит «Фамилия Имя»).
  const visibleRows = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length) return rows
    return rows.filter((r) => {
      const haystack = `${r.name.toLowerCase()} ${r.wards.map((w) => w.name.toLowerCase()).join(" ")}`
      return tokens.every((t) => haystack.includes(t))
    })
  }, [rows, query])

  const searchBar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по ФИО родителя или ребёнка..."
          className="pl-9"
        />
      </div>
      {showBranchFilter && (
        <select
          value={branchId ?? "all"}
          onChange={(e) => setBranch(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="all">Все филиалы</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )

  if (rows.length === 0) {
    return (
      <>
        {searchBar}
        <div className="rounded-md border p-12 text-center text-sm text-muted-foreground">
          Нет клиентов с назначенной датой связи
        </div>
      </>
    )
  }

  if (visibleRows.length === 0) {
    return (
      <>
        {searchBar}
        <div className="rounded-md border p-12 text-center text-sm text-muted-foreground">
          Никто не найден по запросу «{query}»
        </div>
      </>
    )
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return (
    <>
      {searchBar}
      <StickyHScroll className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Статус</TableHead>
              <TableHead>ФИО родителя</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Дети</TableHead>
              <TableHead>След. связь</TableHead>
              <TableHead>Комментарий</TableHead>
              <TableHead>Ответственный</TableHead>
              {canEdit && <TableHead className="w-10"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((r) => {
              const overdue = new Date(r.nextContactDate) < today
              return (
                <TableRow key={r.clientId}>
                  <TableCell>
                    <Badge variant="outline">{statusLabel(r.funnelStatus, r.clientStatus)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link href={`/crm/clients/${r.clientId}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.wards.length === 0
                      ? "—"
                      : r.wards.map((w, i) => (
                          <span key={w.id}>
                            {i > 0 && ", "}
                            <Link href={`/crm/wards/${w.id}`} className="text-primary hover:underline">
                              {w.name}
                            </Link>
                          </span>
                        ))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {canEdit ? (
                      <div className="flex items-center gap-2">
                        <EditableDateCell
                          initialValue={r.nextContactDate.slice(0, 10)}
                          endpoint={{ url: `/api/clients/${r.clientId}`, field: "nextContactDate" }}
                        />
                        {overdue && <Badge variant="destructive" className="text-xs">просрочено</Badge>}
                      </div>
                    ) : (
                      <span className={overdue ? "font-medium text-red-600" : ""}>{fmtDate(r.nextContactDate)}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEdit ? (
                      <EditableTextCell
                        initialValue={r.comment}
                        endpoint={{ url: `/api/clients/${r.clientId}`, field: "comment" }}
                        rows={1}
                        className="min-h-[32px] max-h-[50px] w-[200px] resize-none overflow-y-auto text-xs"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">{r.comment || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.assigneeName || "—"}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <RemoveFromContactButton clientId={r.clientId} name={r.name} />
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </StickyHScroll>
    </>
  )
}
