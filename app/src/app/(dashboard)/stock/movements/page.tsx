"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  fromLabel: string | null
  toLabel: string | null
  stockItem: { name: string; unit: string }
  createdBy: { firstName: string; lastName: string } | null
}

// Остатки трёх локаций — из них собираем «где есть товар».
interface WarehouseBalance { id: string; quantity: string; stockItem: { id: string; name: string; unit: string } }
interface BranchBalance { id: string; quantity: string; stockItem: { id: string; name: string; unit: string }; branch: { id: string; name: string } }
interface RoomBalance { id: string; quantity: string; stockItem: { id: string; name: string; unit: string }; room: { id: string; name: string; branch: { id: string; name: string } } }
interface Branch { id: string; name: string; rooms: { id: string; name: string }[] }

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

// Локация в значении Select: "warehouse" | "branch:<id>" | "room:<id>".
type Loc = { kind: "warehouse" } | { kind: "branch"; id: string } | { kind: "room"; id: string }
function parseLoc(v: string): Loc {
  if (v === "warehouse") return { kind: "warehouse" }
  const [kind, id] = v.split(":")
  return { kind: kind as "branch" | "room", id }
}

export default function MovementsPage() {
  const [movements, setMovements] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [transferOpen, setTransferOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warehouseBalances, setWarehouseBalances] = useState<WarehouseBalance[]>([])
  const [branchBalances, setBranchBalances] = useState<BranchBalance[]>([])
  const [roomBalances, setRoomBalances] = useState<RoomBalance[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  // Поля формы перемещения (контролируемые — base-ui Select не отдаёт значения в FormData).
  const [tItemId, setTItemId] = useState("")
  const [fromLoc, setFromLoc] = useState("")
  const [toLoc, setToLoc] = useState("")
  const [tQty, setTQty] = useState("")
  const [tComment, setTComment] = useState("")

  const load = useCallback(async () => {
    const res = await fetch("/api/stock-movements")
    if (res.ok) setMovements(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function resetTransfer() {
    setTItemId(""); setFromLoc(""); setToLoc(""); setTQty(""); setTComment("")
    setError(null)
  }

  function openTransfer() {
    resetTransfer()
    Promise.all([
      fetch("/api/warehouse-balances").then(r => r.ok ? r.json() : []),
      fetch("/api/stock-balances").then(r => r.ok ? r.json() : []),
      fetch("/api/room-balances").then(r => r.ok ? r.json() : []),
      fetch("/api/branches").then(r => r.ok ? r.json() : []),
    ]).then(([wh, sb, rb, br]) => { setWarehouseBalances(wh); setBranchBalances(sb); setRoomBalances(rb); setBranches(br) })
    setTransferOpen(true)
  }

  // Товары, которые вообще можно переместить — те, что есть хоть где-то (qty > 0).
  const movableItems = useMemo(() => {
    const map = new Map<string, { id: string; name: string; unit: string }>()
    for (const b of warehouseBalances) if (Number(b.quantity) > 0) map.set(b.stockItem.id, b.stockItem)
    for (const b of branchBalances) if (Number(b.quantity) > 0) map.set(b.stockItem.id, b.stockItem)
    for (const b of roomBalances) if (Number(b.quantity) > 0) map.set(b.stockItem.id, b.stockItem)
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"))
  }, [warehouseBalances, branchBalances, roomBalances])

  // Источники для выбранного товара — только локации, где он реально есть.
  const sources = useMemo(() => {
    if (!tItemId) return [] as { key: string; label: string; available: number; unit: string }[]
    const list: { key: string; label: string; available: number; unit: string }[] = []
    for (const b of warehouseBalances) {
      if (b.stockItem.id === tItemId && Number(b.quantity) > 0) {
        list.push({ key: "warehouse", label: "Склад", available: Number(b.quantity), unit: b.stockItem.unit })
      }
    }
    for (const b of branchBalances) {
      if (b.stockItem.id === tItemId && Number(b.quantity) > 0) {
        list.push({ key: `branch:${b.branch.id}`, label: `Филиал · ${b.branch.name}`, available: Number(b.quantity), unit: b.stockItem.unit })
      }
    }
    for (const b of roomBalances) {
      if (b.stockItem.id === tItemId && Number(b.quantity) > 0) {
        list.push({ key: `room:${b.room.id}`, label: `${b.room.branch.name} · каб. ${b.room.name}`, available: Number(b.quantity), unit: b.stockItem.unit })
      }
    }
    return list
  }, [tItemId, warehouseBalances, branchBalances, roomBalances])

  // Приёмник — общий склад, любой филиал или кабинет, кроме выбранного источника.
  const destinations = useMemo(() => {
    const list: { key: string; label: string }[] = [{ key: "warehouse", label: "Склад" }]
    for (const br of branches) {
      list.push({ key: `branch:${br.id}`, label: `Филиал · ${br.name}` })
      for (const r of br.rooms) list.push({ key: `room:${r.id}`, label: `${br.name} · каб. ${r.name}` })
    }
    return list.filter(l => l.key !== fromLoc)
  }, [branches, fromLoc])

  const selectedItem = movableItems.find(i => i.id === tItemId)
  const selectedSource = sources.find(s => s.key === fromLoc)

  async function handleTransfer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!tItemId) { setError("Выберите товар"); return }
    if (!fromLoc) { setError("Выберите, откуда переместить"); return }
    if (!toLoc) { setError("Выберите, куда переместить"); return }
    if (!tQty || Number(tQty) <= 0) { setError("Укажите количество"); return }
    if (selectedSource && Number(tQty) > selectedSource.available) {
      setError(`Недостаточно: доступно ${selectedSource.available} ${selectedSource.unit}`); return
    }

    setSaving(true)
    const res = await fetch("/api/stock-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "transfer",
        stockItemId: tItemId,
        from: parseLoc(fromLoc),
        to: parseLoc(toLoc),
        quantity: Number(tQty),
        comment: tComment || undefined,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Не удалось переместить товар")
      setSaving(false)
      return
    }
    setTransferOpen(false)
    setSaving(false)
    resetTransfer()
    load()
  }

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
          <ArrowRight className="size-4 mr-1" /> Переместить товар
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

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Переместить товар</DialogTitle></DialogHeader>
          <form onSubmit={handleTransfer} className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="space-y-1.5">
              <Label>Товар *</Label>
              <Select value={tItemId} onValueChange={(v) => { if (v) { setTItemId(v); setFromLoc(""); setToLoc("") } }}>
                <SelectTrigger className="w-full">
                  {selectedItem?.name ?? "Выберите товар"}
                </SelectTrigger>
                <SelectContent>
                  {movableItems.length === 0
                    ? <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет товаров с остатком</div>
                    : movableItems.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Откуда *</Label>
              <Select value={fromLoc} onValueChange={(v) => { if (v) { setFromLoc(v); setToLoc("") } }} disabled={!tItemId}>
                <SelectTrigger className="w-full">
                  {selectedSource?.label ?? (tItemId ? "Где взять товар" : "Сначала выберите товар")}
                </SelectTrigger>
                <SelectContent>
                  {sources.map(s => (
                    <SelectItem key={s.key} value={s.key}>{s.label} — {s.available} {s.unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Куда *</Label>
              <Select value={toLoc} onValueChange={(v) => { if (v) setToLoc(v) }} disabled={!fromLoc}>
                <SelectTrigger className="w-full">
                  {destinations.find(d => d.key === toLoc)?.label ?? (fromLoc ? "Куда переместить" : "Сначала выберите источник")}
                </SelectTrigger>
                <SelectContent>
                  {destinations.length === 0
                    ? <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет других локаций</div>
                    : destinations.map(d => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Количество *{selectedSource ? ` (доступно ${selectedSource.available} ${selectedSource.unit})` : ""}</Label>
              <Input type="number" step="0.001" min="0.001" max={selectedSource?.available} value={tQty} onChange={(e) => setTQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Input value={tComment} onChange={(e) => setTComment(e.target.value)} />
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
