"use client"

import { useMemo, useState } from "react"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react"
import { CallItemRow, CALL_STATUS_LABELS, type CallItem } from "./call-item-row"

type SortKey = "clientName" | "phone" | "wardName" | "age" | "clientStatusLabel" | "callStatus" | "comment"
type SortDir = "asc" | "desc"

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "clientName", label: "Клиент" },
  { key: "phone", label: "Телефон" },
  { key: "wardName", label: "Подопечный" },
  { key: "age", label: "Возраст", numeric: true },
  { key: "clientStatusLabel", label: "Статус клиента" },
  { key: "callStatus", label: "Статус" },
  { key: "comment", label: "Комментарий" },
]

/** Значение для сортировки. Возраст — число; остальное — строка для localeCompare. */
function sortValue(item: CallItem, key: SortKey): string | number | null {
  switch (key) {
    case "clientName": return item.clientName
    case "phone": return item.phone
    case "wardName": return item.wardName
    case "age": return item.age
    case "clientStatusLabel": return item.clientStatusLabel
    case "callStatus": return CALL_STATUS_LABELS[item.status] || item.status
    case "comment": return item.comment || item.result || ""
  }
}

export function CampaignItemsTable({ rows, campaignId }: { rows: CallItem[]; campaignId: string }) {
  // По умолчанию — А-Я по клиенту.
  const [sortKey, setSortKey] = useState<SortKey>("clientName")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const sorted = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1
    const col = COLUMNS.find((c) => c.key === sortKey)
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      // Пустые значения всегда в конце, независимо от направления.
      const aEmpty = va == null || va === ""
      const bEmpty = vb == null || vb === ""
      if (aEmpty && bEmpty) return 0
      if (aEmpty) return 1
      if (bEmpty) return -1
      let cmp: number
      if (col?.numeric) {
        cmp = (va as number) - (vb as number)
      } else {
        cmp = String(va).localeCompare(String(vb), "ru")
      }
      return cmp * factor
    })
  }, [rows, sortKey, sortDir])

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {COLUMNS.map((c) => (
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
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((item) => (
            <CallItemRow key={item.id} item={item} campaignId={campaignId} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
