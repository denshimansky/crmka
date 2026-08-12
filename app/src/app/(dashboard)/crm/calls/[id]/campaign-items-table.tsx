"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { WardResultCells, type CallItem } from "./call-item-row"

// Один клиент = одна «запись» (Клиент/Телефон/Статус клиента с rowSpan), напротив —
// строки подопечных. Сортировка только групповая (по столбцам клиента) — переставляет
// клиентов целиком, не разрывая merged-ячейку. У столбцов подопечных сортировки нет.
type GroupSortKey = "clientName" | "phone" | "clientStatusLabel"
type SortDir = "asc" | "desc"

const CLIENT_COLUMNS: { key: GroupSortKey; label: string }[] = [
  { key: "clientName", label: "Клиент" },
  { key: "phone", label: "Телефон" },
  { key: "clientStatusLabel", label: "Статус клиента" },
]

// Столбцы подопечного — просто заголовки, без сортировки (иначе рвётся merged-ячейка).
const WARD_COLUMNS = ["Подопечный", "Возраст", "Статус", "Дата обработки", "Ответственный", "Комментарий"]

interface ClientGroup {
  clientId: string
  clientName: string
  phone: string
  clientStatusLabel: string
  wards: CallItem[]
}

/** Группировка строк по клиенту с сохранением порядка появления. */
function groupByClient(rows: CallItem[]): ClientGroup[] {
  const map = new Map<string, ClientGroup>()
  for (const r of rows) {
    let g = map.get(r.clientId)
    if (!g) {
      g = {
        clientId: r.clientId,
        clientName: r.clientName,
        phone: r.phone,
        clientStatusLabel: r.clientStatusLabel,
        wards: [],
      }
      map.set(r.clientId, g)
    }
    g.wards.push(r)
  }
  // Подопечные внутри клиента — по имени А-Я (пустые в конец).
  for (const g of map.values()) {
    g.wards.sort((a, b) => {
      if (!a.wardName && !b.wardName) return 0
      if (!a.wardName) return 1
      if (!b.wardName) return -1
      return a.wardName.localeCompare(b.wardName, "ru")
    })
  }
  return [...map.values()]
}

function groupSortValue(g: ClientGroup, key: GroupSortKey): string {
  return g[key] ?? ""
}

export function CampaignItemsTable({
  rows,
  campaignId,
  readOnly = false,
}: {
  rows: CallItem[]
  campaignId: string
  readOnly?: boolean
}) {
  // По умолчанию — А-Я по клиенту.
  const [sortKey, setSortKey] = useState<GroupSortKey>("clientName")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  function toggleSort(key: GroupSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const groups = useMemo(() => {
    const gs = groupByClient(rows)
    const factor = sortDir === "asc" ? 1 : -1
    return gs.sort((a, b) => {
      const va = groupSortValue(a, sortKey)
      const vb = groupSortValue(b, sortKey)
      const aEmpty = va === ""
      const bEmpty = vb === ""
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      return va.localeCompare(vb, "ru") * factor
    })
  }, [rows, sortKey, sortDir])

  return (
    <StickyHScroll className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {CLIENT_COLUMNS.map((c) => (
              <TableHead key={c.key}>
                <button
                  type="button"
                  onClick={() => toggleSort(c.key)}
                  className="flex items-center gap-1 hover:text-foreground"
                >
                  {c.label}
                  {sortKey === c.key ? (
                    sortDir === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronsUpDown className="size-3.5 opacity-40" />
                  )}
                </button>
              </TableHead>
            ))}
            {WARD_COLUMNS.map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) =>
            g.wards.map((item, i) => (
              <TableRow key={item.id} className={i === 0 ? "border-t-2 border-t-muted" : ""}>
                {i === 0 && (
                  <>
                    <TableCell rowSpan={g.wards.length} className="align-top">
                      <Link href={`/crm/clients/${g.clientId}`} className="font-medium text-primary hover:underline">
                        {g.clientName}
                      </Link>
                    </TableCell>
                    <TableCell rowSpan={g.wards.length} className="align-top whitespace-nowrap text-muted-foreground">
                      {g.phone || "—"}
                    </TableCell>
                    <TableCell rowSpan={g.wards.length} className="align-top text-muted-foreground text-xs">
                      {g.clientStatusLabel || "—"}
                    </TableCell>
                  </>
                )}
                <WardResultCells item={item} campaignId={campaignId} readOnly={readOnly} />
              </TableRow>
            )),
          )}
        </TableBody>
      </Table>
    </StickyHScroll>
  )
}
