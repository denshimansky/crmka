"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { ArrowLeft, ArrowRightLeft, Trash2 } from "lucide-react"
import Link from "next/link"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { MoveStockDialog, type MoveSource, type MoveBranch } from "@/components/move-stock-dialog"

interface RoomBalance {
  id: string
  quantity: string
  totalCost: string
  stockItem: { id: string; name: string; unit: string }
  room: { id: string; name: string; branch: { id: string; name: string } }
}

function formatMoney(v: number) {
  return new Intl.NumberFormat("ru-RU").format(v) + " ₽"
}

export default function RoomBalancesPage() {
  const [balances, setBalances] = useState<RoomBalance[]>([])
  const [branches, setBranches] = useState<MoveBranch[]>([])
  const [moveSource, setMoveSource] = useState<MoveSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [writeOffOpen, setWriteOffOpen] = useState(false)
  const [writeOffItem, setWriteOffItem] = useState<RoomBalance | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [rbRes, brRes] = await Promise.all([
      fetch("/api/room-balances"),
      fetch("/api/branches"),
    ])
    if (rbRes.ok) setBalances(await rbRes.json())
    if (brRes.ok) setBranches(await brRes.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openWriteOff(item: RoomBalance) {
    setWriteOffItem(item)
    setWriteOffOpen(true)
  }

  async function handleWriteOff(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!writeOffItem) return
    setSaving(true)
    const fd = new FormData(e.currentTarget)
    await fetch("/api/stock-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "write_off",
        stockItemId: writeOffItem.stockItem.id,
        from: { kind: "room", id: writeOffItem.room.id },
        quantity: Number(fd.get("quantity")),
        comment: fd.get("comment") || undefined,
      }),
    })
    setWriteOffOpen(false)
    setSaving(false)
    load()
  }

  // Группировка: филиал → кабинет
  const grouped: Record<string, Record<string, RoomBalance[]>> = {}
  for (const b of balances) {
    const branch = b.room.branch.name
    const room = b.room.name
    if (!grouped[branch]) grouped[branch] = {}
    if (!grouped[branch][room]) grouped[branch][room] = []
    grouped[branch][room].push(b)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/stock">
          <Button variant="ghost" size="icon"><ArrowLeft className="size-4" /></Button>
        </Link>
        <h1 className="text-2xl font-bold">Баланс кабинетов</h1>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Загрузка...</p>
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            В кабинетах нет товаров. Переместите товар со склада.
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([branchName, rooms]) => (
          <div key={branchName} className="space-y-3">
            <h2 className="text-lg font-semibold">{branchName}</h2>
            {Object.entries(rooms).map(([roomName, items]) => (
              <Card key={roomName}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{roomName}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Наименование</TableHead>
                        <TableHead className="text-right">Кол-во</TableHead>
                        <TableHead className="text-right">Стоимость</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(b => (
                        <ContextMenu key={b.id}>
                          <ContextMenuTrigger asChild>
                            <TableRow>
                              <TableCell>{b.stockItem.name} <span className="text-xs text-muted-foreground">({b.stockItem.unit})</span></TableCell>
                              <TableCell className="text-right">{Number(b.quantity)}</TableCell>
                              <TableCell className="text-right">{formatMoney(Number(b.totalCost))}</TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="size-7" title="Списать" onClick={() => openWriteOff(b)}>
                                  <Trash2 className="size-3.5 text-red-500" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem disabled={Number(b.quantity) <= 0} onClick={() => setMoveSource({
                              stockItemId: b.stockItem.id, itemName: b.stockItem.name, unit: b.stockItem.unit,
                              available: Number(b.quantity), from: { kind: "room", id: b.room.id },
                              fromLabel: `${b.room.branch.name} · каб. ${b.room.name}`,
                            })}>
                              <ArrowRightLeft className="size-3.5" /> Переместить
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        ))
      )}

      {/* Переместить товар (правый клик по строке) */}
      <MoveStockDialog source={moveSource} branches={branches} onClose={() => setMoveSource(null)} onMoved={load} />

      <Dialog open={writeOffOpen} onOpenChange={setWriteOffOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Списание</DialogTitle></DialogHeader>
          {writeOffItem && (
            <form onSubmit={handleWriteOff} className="space-y-4">
              <p className="text-sm">
                <b>{writeOffItem.stockItem.name}</b> из {writeOffItem.room.name}
                <br />Доступно: {Number(writeOffItem.quantity)} {writeOffItem.stockItem.unit}
              </p>
              <div className="space-y-1.5">
                <Label>Количество *</Label>
                <Input name="quantity" type="number" step="0.001" min="0.001" max={Number(writeOffItem.quantity)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Комментарий</Label>
                <Input name="comment" />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setWriteOffOpen(false)}>Отмена</Button>
                <Button type="submit" variant="destructive" disabled={saving}>{saving ? "..." : "Списать"}</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
