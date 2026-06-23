"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

interface Movement {
  id: string
  type: string
  quantity: string
  unitCost: string | null
  totalCost: string
  date: string
  comment: string | null
  fromLabel: string | null
  toLabel: string | null
  stockItem: { name: string; unit: string }
  createdBy: { firstName: string; lastName: string } | null
}

const TYPE_LABELS: Record<string, string> = {
  purchase: "Внесение",
  transfer: "Перемещение",
  transfer_to_room: "Перемещение",
  write_off: "Списание",
}

const TYPE_COLORS: Record<string, string> = {
  purchase: "bg-green-100 text-green-800",
  transfer: "bg-blue-100 text-blue-800",
  transfer_to_room: "bg-blue-100 text-blue-800",
  write_off: "bg-red-100 text-red-800",
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function formatMoney(v: number) {
  return new Intl.NumberFormat("ru-RU").format(v) + " ₽"
}

// Колонка «Откуда → Куда» в журнале.
function routeLabel(m: Movement): string {
  if (m.type === "purchase") return m.toLabel ? `→ ${m.toLabel}` : (m.fromLabel ? `→ ${m.fromLabel}` : "—")
  if (m.type === "write_off") {
    const src = m.fromLabel ?? m.toLabel
    return src ? `${src} →` : "—"
  }
  const parts = [m.fromLabel, m.toLabel].filter(Boolean)
  return parts.length ? parts.join(" → ") : "—"
}

export default function MovementsPage() {
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch("/api/stock-movements")
    if (res.ok) setMovements(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/stock">
          <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
        </Link>
        <h1 className="text-2xl font-bold">Движения товаров</h1>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Загрузка...</p>
      ) : movements.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет движений. Перемещайте товар правым кликом по строке на складе или в кабинетах.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Наименование</TableHead>
                  <TableHead>Откуда → Куда</TableHead>
                  <TableHead className="text-right">Кол-во</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Комментарий</TableHead>
                  <TableHead>Кто</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map(m => (
                  <TableRow key={m.id}>
                    <TableCell>{formatDate(m.date)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[m.type] || ""}`}>
                        {TYPE_LABELS[m.type] || m.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">{m.stockItem.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{routeLabel(m)}</TableCell>
                    <TableCell className="text-right">{Number(m.quantity)} {m.stockItem.unit}</TableCell>
                    <TableCell className="text-right">{formatMoney(Number(m.totalCost))}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{m.comment || "—"}</TableCell>
                    <TableCell className="text-xs">
                      {m.createdBy ? `${m.createdBy.lastName} ${m.createdBy.firstName?.[0]}.` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
