"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import { ArrowLeft, ArrowRightLeft } from "lucide-react"
import Link from "next/link"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { MoveStockDialog, type MoveSource, type MoveBranch } from "@/components/move-stock-dialog"
import {
  WriteOffStockDialog, type WriteOffSource, type WriteOffCategory, type WriteOffDirection,
} from "@/components/write-off-stock-dialog"

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
  const [categories, setCategories] = useState<WriteOffCategory[]>([])
  const [directions, setDirections] = useState<WriteOffDirection[]>([])
  const [moveSource, setMoveSource] = useState<MoveSource | null>(null)
  const [writeOffSource, setWriteOffSource] = useState<WriteOffSource | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [rbRes, brRes, catRes, dirRes] = await Promise.all([
      fetch("/api/room-balances"),
      fetch("/api/branches"),
      fetch("/api/expense-categories"),
      fetch("/api/directions"),
    ])
    if (rbRes.ok) setBalances(await rbRes.json())
    if (brRes.ok) setBranches(await brRes.json())
    if (catRes.ok) {
      const cats: (WriteOffCategory & { isSalary?: boolean })[] = await catRes.json()
      setCategories(cats.filter((c) => !c.isSalary).map((c) => ({ id: c.id, name: c.name, isVariable: c.isVariable })))
    }
    if (dirRes.ok) {
      const dirs: { id: string; name: string }[] = await dirRes.json()
      setDirections(dirs.map((d) => ({ id: d.id, name: d.name })))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Группировка: филиал → кабинет. Нулевые остатки скрываем.
  const grouped: Record<string, Record<string, RoomBalance[]>> = {}
  for (const b of balances) {
    if (Number(b.quantity) <= 0) continue
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
            В кабинетах нет товаров. Переместите товар со склада (правый клик по строке).
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
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(b => {
                        const qty = Number(b.quantity)
                        const cost = Number(b.totalCost)
                        const row = {
                          stockItemId: b.stockItem.id, name: b.stockItem.name, unit: b.stockItem.unit,
                          quantity: qty, totalCost: cost,
                          from: { kind: "room" as const, id: b.room.id },
                          fromLabel: `${b.room.branch.name} · каб. ${b.room.name}`,
                          branchId: b.room.branch.id,
                        }
                        return (
                          <ContextMenu key={b.id}>
                            <ContextMenuTrigger asChild>
                              <TableRow>
                                <TableCell>{b.stockItem.name} <span className="text-xs text-muted-foreground">({b.stockItem.unit})</span></TableCell>
                                <TableCell className="text-right">{qty}</TableCell>
                                <TableCell className="text-right">{formatMoney(cost)}</TableCell>
                                <TableCell className="text-right">
                                  <Button variant="ghost" size="sm" className="h-7 text-red-600 hover:text-red-700" onClick={() => setWriteOffSource({
                                    stockItemId: row.stockItemId, itemName: row.name, unit: row.unit,
                                    available: qty, unitCost: qty > 0 ? cost / qty : 0,
                                    from: row.from, fromLabel: row.fromLabel, branchId: row.branchId,
                                  })}>Списать</Button>
                                </TableCell>
                              </TableRow>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onClick={() => setMoveSource({
                                stockItemId: row.stockItemId, itemName: row.name, unit: row.unit,
                                available: qty, from: row.from, fromLabel: row.fromLabel,
                              })}>
                                <ArrowRightLeft className="size-3.5" /> Переместить
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        )
                      })}
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

      {/* Списание товара (кнопка «Списать») */}
      <WriteOffStockDialog
        source={writeOffSource}
        categories={categories}
        branches={branches}
        directions={directions}
        onClose={() => setWriteOffSource(null)}
        onDone={load}
      />
    </div>
  )
}
