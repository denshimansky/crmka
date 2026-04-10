"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { ArrowLeft, ArrowRight } from "lucide-react"
import Link from "next/link"

interface Movement {
  id: string
  type: string
  quantity: string
  unitCost: string | null
  totalCost: string
  date: string
  comment: string | null
  fromBranchId: string | null
  toRoomId: string | null
  stockItem: { name: string; unit: string }
  createdBy: { firstName: string; lastName: string } | null
}

interface StockItem { id: string; name: string; unit: string }
interface Branch { id: string; name: string; rooms: { id: string; name: string }[] }

const TYPE_LABELS: Record<string, string> = {
  purchase: "Закупка",
  transfer_to_room: "Перемещение",
  write_off: "Списание",
}

const TYPE_COLORS: Record<string, string> = {
  purchase: "bg-green-100 text-green-800",
  transfer_to_room: "bg-blue-100 text-blue-800",
  write_off: "bg-red-100 text-red-800",
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function formatMoney(v: number) {
  return new Intl.NumberFormat("ru-RU").format(v) + " ₽"
}

export default function MovementsPage() {
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [transferOpen, setTransferOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<StockItem[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranch, setSelectedBranch] = useState("")

  const load = useCallback(async () => {
    const res = await fetch("/api/stock-movements")
    if (res.ok) setMovements(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openTransfer() {
    Promise.all([
      fetch("/api/stock-items").then(r => r.ok ? r.json() : []),
      fetch("/api/branches?includeRooms=true").then(r => r.ok ? r.json() : []),
    ]).then(([it, br]) => { setItems(it); setBranches(br) })
    setTransferOpen(true)
  }

  async function handleTransfer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const res = await fetch("/api/stock-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "transfer_to_room",
        stockItemId: fd.get("stockItemId"),
        fromBranchId: fd.get("fromBranchId"),
        toRoomId: fd.get("toRoomId"),
        quantity: Number(fd.get("quantity")),
        comment: fd.get("comment") || undefined,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Недостаточно товара на складе")
      setSaving(false)
      return
    }
    setTransferOpen(false)
    setSaving(false)
    load()
  }

  const selectedRooms = branches.find(b => b.id === selectedBranch)?.rooms || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/stock">
            <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
          </Link>
          <h1 className="text-2xl font-bold">Перемещения</h1>
        </div>
        <Button size="sm" onClick={openTransfer}>
          <ArrowRight className="size-4 mr-1" /> Переместить в кабинет
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Загрузка...</p>
      ) : movements.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Нет перемещений
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

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Переместить в кабинет</DialogTitle></DialogHeader>
          <form onSubmit={handleTransfer} className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="space-y-1.5">
              <Label>Товар *</Label>
              <Select name="stockItemId" required>
                <SelectTrigger className="w-full">Выберите товар</SelectTrigger>
                <SelectContent>
                  {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Со склада (филиал) *</Label>
              <Select name="fromBranchId" required onValueChange={setSelectedBranch}>
                <SelectTrigger className="w-full">Выберите филиал</SelectTrigger>
                <SelectContent>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>В кабинет *</Label>
              <Select name="toRoomId" required disabled={!selectedBranch}>
                <SelectTrigger className="w-full">{selectedBranch ? "Выберите кабинет" : "Сначала выберите филиал"}</SelectTrigger>
                <SelectContent>
                  {selectedRooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Количество *</Label>
              <Input name="quantity" type="number" step="0.001" min="0.001" required />
            </div>
            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Input name="comment" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setTransferOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={saving}>{saving ? "..." : "Переместить"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
