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
import { PackagePlus, ArrowRight, ArrowRightLeft, Package } from "lucide-react"
import Link from "next/link"
import { PageHelp } from "@/components/page-help"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { MoveStockDialog, type MoveSource, type MoveBranch } from "@/components/move-stock-dialog"
import {
  WriteOffStockDialog, type WriteOffSource, type WriteOffCategory, type WriteOffDirection,
} from "@/components/write-off-stock-dialog"

interface WarehouseBalance {
  id: string
  quantity: string
  totalCost: string
  stockItem: { id: string; name: string; unit: string }
}

interface BranchBalance {
  id: string
  quantity: string
  totalCost: string
  stockItem: { id: string; name: string; unit: string }
  branch: { id: string; name: string }
}

interface RoomBalance {
  id: string
  quantity: string
  totalCost: string
  stockItem: { id: string; name: string; unit: string }
  room: { id: string; name: string; branch: { id: string; name: string } }
}

interface StockItem {
  id: string
  name: string
  unit: string
  defaultUnitCost: string | null
}

// Строка размещения товара в филиале/кабинете (для объединённого списка по филиалу).
interface LocationRow {
  key: string
  stockItemId: string
  name: string
  unit: string
  quantity: number
  totalCost: number
  cabinet: string | null // null — на филиале (без кабинета)
  from: WriteOffSource["from"]
  fromLabel: string
  branchId: string
}

function formatMoney(v: number) {
  return new Intl.NumberFormat("ru-RU").format(v) + " ₽"
}

export default function StockPage() {
  const [warehouse, setWarehouse] = useState<WarehouseBalance[]>([])
  const [branchBalances, setBranchBalances] = useState<BranchBalance[]>([])
  const [roomBalances, setRoomBalances] = useState<RoomBalance[]>([])
  const [items, setItems] = useState<StockItem[]>([])
  const [branches, setBranches] = useState<MoveBranch[]>([])
  const [categories, setCategories] = useState<WriteOffCategory[]>([])
  const [directions, setDirections] = useState<WriteOffDirection[]>([])
  const [moveSource, setMoveSource] = useState<MoveSource | null>(null)
  const [writeOffSource, setWriteOffSource] = useState<WriteOffSource | null>(null)
  const [loading, setLoading] = useState(true)

  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Поля формы «Внести на склад»
  const [itemName, setItemName] = useState("")
  const [unit, setUnit] = useState("шт")
  const [unitCost, setUnitCost] = useState("")
  const [quantity, setQuantity] = useState("")

  const load = useCallback(async () => {
    const [whRes, brRes, rbRes, itemRes, branchRes, catRes, dirRes] = await Promise.all([
      fetch("/api/warehouse-balances"),
      fetch("/api/stock-balances"),
      fetch("/api/room-balances"),
      fetch("/api/stock-items"),
      fetch("/api/branches"),
      fetch("/api/expense-categories"),
      fetch("/api/directions"),
    ])
    if (whRes.ok) setWarehouse(await whRes.json())
    if (brRes.ok) setBranchBalances(await brRes.json())
    if (rbRes.ok) setRoomBalances(await rbRes.json())
    if (itemRes.ok) setItems(await itemRes.json())
    if (branchRes.ok) setBranches(await branchRes.json())
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

  function resetForm() {
    setItemName(""); setUnit("шт"); setUnitCost(""); setQuantity("")
    setError(null)
  }

  const matchedItem = items.find(
    (i) => i.name.trim().toLowerCase() === itemName.trim().toLowerCase(),
  )

  function onItemNameChange(v: string) {
    setItemName(v)
    const m = items.find((i) => i.name.trim().toLowerCase() === v.trim().toLowerCase())
    if (m) {
      setUnit(m.unit)
      if (!unitCost && m.defaultUnitCost) setUnitCost(String(Number(m.defaultUnitCost)))
    }
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!itemName.trim()) { setError("Укажите наименование"); return }
    if (!quantity || Number(quantity) <= 0) { setError("Укажите количество"); return }
    if (!unitCost || Number(unitCost) < 0) { setError("Укажите цену за единицу"); return }

    setSaving(true)
    const res = await fetch("/api/stock-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "purchase",
        ...(matchedItem ? { stockItemId: matchedItem.id } : { itemName: itemName.trim(), unit: unit.trim() || "шт" }),
        quantity: Number(quantity),
        unitCost: Number(unitCost),
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Ошибка")
      setSaving(false)
      return
    }
    setAddOpen(false)
    setSaving(false)
    resetForm()
    load()
  }

  // Остатки филиалов + кабинетов, сгруппированные по филиалу. Нулевые остатки скрываем.
  const branchGroups: Record<string, { branchName: string; rows: LocationRow[] }> = {}
  for (const b of branchBalances) {
    const qty = Number(b.quantity)
    if (qty <= 0) continue
    const g = (branchGroups[b.branch.id] ??= { branchName: b.branch.name, rows: [] })
    g.rows.push({
      key: b.id, stockItemId: b.stockItem.id, name: b.stockItem.name, unit: b.stockItem.unit,
      quantity: qty, totalCost: Number(b.totalCost), cabinet: null,
      from: { kind: "branch", id: b.branch.id }, fromLabel: `Филиал · ${b.branch.name}`, branchId: b.branch.id,
    })
  }
  for (const b of roomBalances) {
    const qty = Number(b.quantity)
    if (qty <= 0) continue
    const g = (branchGroups[b.room.branch.id] ??= { branchName: b.room.branch.name, rows: [] })
    g.rows.push({
      key: b.id, stockItemId: b.stockItem.id, name: b.stockItem.name, unit: b.stockItem.unit,
      quantity: qty, totalCost: Number(b.totalCost), cabinet: b.room.name,
      from: { kind: "room", id: b.room.id }, fromLabel: `${b.room.branch.name} · каб. ${b.room.name}`, branchId: b.room.branch.id,
    })
  }
  // Сортировка строк внутри филиала: по наименованию, затем по кабинету.
  for (const g of Object.values(branchGroups)) {
    g.rows.sort((a, c) => a.name.localeCompare(c.name, "ru") || (a.cabinet ?? "").localeCompare(c.cabinet ?? "", "ru"))
  }

  const warehouseRows = warehouse.filter((b) => Number(b.quantity) > 0)
  const whCost = warehouseRows.reduce((s, b) => s + Number(b.totalCost), 0)

  const previewSum = Number(quantity) > 0 && Number(unitCost) >= 0
    ? Number(quantity) * Number(unitCost)
    : 0

  function moveFrom(row: { stockItemId: string; name: string; unit: string; quantity: number; from: MoveSource["from"]; fromLabel: string }) {
    setMoveSource({
      stockItemId: row.stockItemId, itemName: row.name, unit: row.unit,
      available: row.quantity, from: row.from, fromLabel: row.fromLabel,
    })
  }
  function writeOffFrom(row: { stockItemId: string; name: string; unit: string; quantity: number; totalCost: number; from: WriteOffSource["from"]; fromLabel: string; branchId?: string }) {
    setWriteOffSource({
      stockItemId: row.stockItemId, itemName: row.name, unit: row.unit,
      available: row.quantity, unitCost: row.quantity > 0 ? row.totalCost / row.quantity : 0,
      from: row.from, fromLabel: row.fromLabel, branchId: row.branchId,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Склад</h1>
          <PageHelp pageKey="stock" />
        </div>
        <div className="flex items-center gap-2">
          <Link href="/stock/rooms">
            <Button variant="outline" size="sm">
              <Package className="size-4 mr-1" /> Кабинеты
            </Button>
          </Link>
          <Link href="/stock/movements">
            <Button variant="outline" size="sm">
              <ArrowRight className="size-4 mr-1" /> Движения товаров
            </Button>
          </Link>
          <Button size="sm" onClick={() => { resetForm(); setAddOpen(true) }}>
            <PackagePlus className="size-4 mr-1" /> Внести на склад
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Позиций на складе</p>
            <p className="text-2xl font-bold">{warehouseRows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Стоимость склада</p>
            <p className="text-2xl font-bold">{formatMoney(whCost)}</p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Загрузка...</p>
      ) : (
        <>
          {/* Общий склад */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">На складе</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {warehouseRows.length === 0 ? (
                <div className="flex items-center justify-center p-10 text-muted-foreground text-sm">
                  Склад пуст. Нажмите «Внести на склад».
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Наименование</TableHead>
                      <TableHead className="text-right">Кол-во</TableHead>
                      <TableHead className="text-right">Цена за ед.</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {warehouseRows.map(b => {
                      const qty = Number(b.quantity)
                      const cost = Number(b.totalCost)
                      const perUnit = qty > 0 ? cost / qty : 0
                      const row = {
                        stockItemId: b.stockItem.id, name: b.stockItem.name, unit: b.stockItem.unit,
                        quantity: qty, totalCost: cost,
                        from: { kind: "warehouse" as const }, fromLabel: "Склад", branchId: undefined,
                      }
                      return (
                        <ContextMenu key={b.id}>
                          <ContextMenuTrigger asChild>
                            <TableRow>
                              <TableCell className="font-medium">{b.stockItem.name} <span className="text-muted-foreground text-xs">({b.stockItem.unit})</span></TableCell>
                              <TableCell className="text-right">{qty}</TableCell>
                              <TableCell className="text-right">{formatMoney(perUnit)}</TableCell>
                              <TableCell className="text-right font-medium">{formatMoney(cost)}</TableCell>
                              <TableCell className="text-right">
                                <Button variant="ghost" size="sm" className="h-7 text-red-600 hover:text-red-700" onClick={() => writeOffFrom(row)}>Списать</Button>
                              </TableCell>
                            </TableRow>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => moveFrom(row)}>
                              <ArrowRightLeft className="size-3.5" /> Переместить
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Остатки в филиалах и кабинетах */}
          {Object.entries(branchGroups).map(([branchId, g]) => (
            <Card key={branchId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Филиал · {g.branchName}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Наименование</TableHead>
                      <TableHead>Кабинет</TableHead>
                      <TableHead className="text-right">Кол-во</TableHead>
                      <TableHead className="text-right">Стоимость</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.rows.map(r => (
                      <ContextMenu key={r.key}>
                        <ContextMenuTrigger asChild>
                          <TableRow>
                            <TableCell className="font-medium">{r.name} <span className="text-muted-foreground text-xs">({r.unit})</span></TableCell>
                            <TableCell className="text-muted-foreground">{r.cabinet ?? "— на филиале —"}</TableCell>
                            <TableCell className="text-right">{r.quantity}</TableCell>
                            <TableCell className="text-right font-medium">{formatMoney(r.totalCost)}</TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" className="h-7 text-red-600 hover:text-red-700" onClick={() => writeOffFrom(r)}>Списать</Button>
                            </TableCell>
                          </TableRow>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => moveFrom(r)}>
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
        </>
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

      {/* Внести на склад */}
      <Dialog open={addOpen} onOpenChange={(v) => { setAddOpen(v); if (!v) resetForm() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Внести на склад</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

            <div className="space-y-1.5">
              <Label>Наименование *</Label>
              <Input
                value={itemName}
                onChange={(e) => onItemNameChange(e.target.value)}
                list="stock-items-datalist"
                placeholder="Бумага A4, краски, пластилин..."
              />
              <datalist id="stock-items-datalist">
                {items.map((i) => <option key={i.id} value={i.name} />)}
              </datalist>
              <p className="text-xs text-muted-foreground">
                {matchedItem ? "Существующий товар — пополним остаток." : "Новый товар — будет создан."}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Кол-во *</Label>
                <Input type="number" step="0.001" min="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Ед.</Label>
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!!matchedItem} />
              </div>
              <div className="space-y-1.5">
                <Label>Цена за ед. *</Label>
                <Input type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              </div>
            </div>

            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Товар на сумму {formatMoney(previewSum)} попадёт на общий склад. На финансы (ДДС/ОПИУ) не влияет. Дальше его можно переместить в филиалы и кабинеты.
            </p>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={saving}>{saving ? "..." : "Внести на склад"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
