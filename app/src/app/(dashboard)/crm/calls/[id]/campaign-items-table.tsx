"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search } from "lucide-react"
import { StickyHScroll } from "@/components/sticky-h-scroll"
import { WardResultCells, type CallItem } from "./call-item-row"

// Один клиент = одна «запись» (Клиент/Телефон/Статус клиента с rowSpan), напротив —
// строки подопечных. Сортировок по столбцам нет. Порядок фиксированный: клиенты с
// необработанными детьми — сверху А-Я, полностью отработанные клиенты — вниз списка.
const CLIENT_COLUMNS = ["Клиент", "Телефон", "Статус клиента"]
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

/** Склейка для поиска по клиенту: имя клиента + все дети + телефон (+ цифры). */
function groupHaystack(g: ClientGroup): string {
  const phoneDigits = g.phone.replace(/\D/g, "")
  const wardNames = g.wards.map((w) => w.wardName).join(" ")
  return `${g.clientName} ${wardNames} ${g.phone} ${phoneDigits}`.toLowerCase()
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
  const [query, setQuery] = useState("")

  const groups = useMemo(() => {
    // Поиск по токенам на уровне КЛИЕНТА: каждое слово запроса ищется в склейке
    // «клиент + все его дети + телефон». Совпадение (в т.ч. по имени ребёнка)
    // показывает клиента целиком, со всеми детьми.
    const q = query.trim().toLowerCase()
    const tokens = q ? q.split(/\s+/).filter(Boolean) : []
    let gs = groupByClient(rows)
    if (tokens.length) {
      gs = gs.filter((g) => {
        const h = groupHaystack(g)
        return tokens.every((t) => h.includes(t))
      })
    }
    // Порядок: клиенты с необработанными детьми — сверху; полностью отработанные —
    // вниз. Внутри каждого уровня — А-Я по клиенту.
    return gs.sort((a, b) => {
      const aDone = a.wards.every((w) => w.status !== "pending")
      const bDone = b.wards.every((w) => w.status !== "pending")
      if (aDone !== bDone) return aDone ? 1 : -1
      return a.clientName.localeCompare(b.clientName, "ru")
    })
  }, [rows, query])

  const totalCols = CLIENT_COLUMNS.length + WARD_COLUMNS.length + 1

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по клиенту, ребёнку или телефону..."
          className="pl-9"
        />
      </div>

      <StickyHScroll className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {CLIENT_COLUMNS.map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
              {WARD_COLUMNS.map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalCols} className="py-8 text-center text-muted-foreground">
                  Ничего не найдено
                </TableCell>
              </TableRow>
            ) : (
              groups.map((g) =>
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
              )
            )}
          </TableBody>
        </Table>
      </StickyHScroll>
    </div>
  )
}
