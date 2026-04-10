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
import { ArrowLeft, Trash2 } from "lucide-react"
import Link from "next/link"

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
  const [loading, setLoading] = useState(true)
  const [writeOffOpen, setWriteOffOpen] = useState(false)
  const [writeOffItem, setWriteOffItem] = useState<RoomBalance | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/room-balances")
    if (res.ok) setBalances(await res.json())
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
        roomId: writeOffItem.room.id,
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
                        <TableRow key={b.id}>
                          <TableCell>{b.stockItem.name} <span className="text-xs text-muted-foreground">({b.stockItem.unit})</span></TableCell>
                          <TableCell className="text-right">{Number(b.quantity)}</TableCell>
                          <TableCell className="text-right">{formatMoney(Number(b.totalCost))}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="size-7" title="Списать" onClick={() => openWriteOff(b)}>
                              <Trash2 className="size-3.5 text-red-500" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        ))
      )}

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
