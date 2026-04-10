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
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from "@/components/ui/select"
import { Plus, ShoppingCart, ArrowRight, Package } from "lucide-react"
import Link from "next/link"

interface StockBalance {
  id: string
  quantity: string
  totalCost: string
  stockItem: { id: string; name: string; unit: string }
  branch: { id: string; name: string }
}

interface StockItem {
  id: string
  name: string
  unit: string
  defaultUnitCost: string | null
}

interface Branch {
  id: string
  name: string
}

function formatMoney(v: number) {
  return new Intl.NumberFormat("ru-RU").format(v) + " ₽"
}

export default function StockPage() {
  const [balances, setBalances] = useState<StockBalance[]>([])
  const [items, setItems] = useState<StockItem[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)

  const [createOpen, setCreateOpen] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [balRes, itemRes, brRes] = await Promise.all([
      fetch("/api/stock-balances"),
      fetch("/api/stock-items"),
      fetch("/api/branches"),
    ])
    if (balRes.ok) setBalances(await balRes.json())
    if (itemRes.ok) setItems(await itemRes.json())
    if (brRes.ok) setBranches(await brRes.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreateItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const res = await fetch("/api/stock-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        unit: fd.get("unit") || "шт",
        defaultUnitCost: Number(fd.get("defaultUnitCost")) || undefined,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Ошибка")
      setSaving(false)
      return
    }
    setCreateOpen(false)
    setSaving(false)
    load()
  }

  async function handlePurchase(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const fd = new FormData(e.currentTarget)
    const res = await fetch("/api/stock-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "purchase",
        stockItemId: fd.get("stockItemId"),
        branchId: fd.get("branchId"),
        quantity: Number(fd.get("quantity")),
        unitCost: Number(fd.get("unitCost")),
        amortizationMonths: Number(fd.get("amortizationMonths")) || undefined,
        comment: fd.get("comment") || undefined,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Ошибка")
      setSaving(false)
      return
    }
    setPurchaseOpen(false)
    setSaving(false)
    load()
  }

  // Группировка по филиалу
  const grouped = balances.reduce<Record<string, StockBalance[]>>((acc, b) => {
    const key = b.branch.name
    if (!acc[key]) acc[key] = []
    acc[key].push(b)
    return acc
  }, {})

  const totalItems = balances.reduce((sum, b) => sum + Number(b.quantity), 0)
  const totalCost = balances.reduce((sum, b) => sum + Number(b.totalCost), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Склад</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/stock/rooms">
            <Button variant="outline" size="sm">
              <Package className="size-4 mr-1" /> Кабинеты
            </Button>
          </Link>
          <Link href="/stock/movements">
            <Button variant="outline" size="sm">
              <ArrowRight className="size-4 mr-1" /> Перемещения
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1" /> Товар
          </Button>
          <Button size="sm" onClick={() => setPurchaseOpen(true)}>
            <ShoppingCart className="size-4 mr-1" /> Закупка
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Всего на складах</p>
            <p className="text-2xl font-bold">{totalItems} ед.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Общая стоимость</p>
            <p className="text-2xl font-bold">{formatMoney(totalCost)}</p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-8">Загрузка...</p>
      ) : Object.keys(grouped).length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Склад пуст. Добавьте товар и оформите закупку.
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([branchName, items]) => (
          <Card key={branchName}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{branchName}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Наименование</TableHead>
                    <TableHead className="text-right">Кол-во</TableHead>
                    <TableHead className="text-right">Стоимость за ед.</TableHead>
                    <TableHead className="text-right">Сумма</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(b => {
                    const qty = Number(b.quantity)
                    const cost = Number(b.totalCost)
                    const unitCost = qty > 0 ? cost / qty : 0
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.stockItem.name} <span className="text-muted-foreground text-xs">({b.stockItem.unit})</span></TableCell>
                        <TableCell className="text-right">{qty}</TableCell>
                        <TableCell className="text-right">{formatMoney(unitCost)}</TableCell>
                        <TableCell className="text-right font-medium">{formatMoney(cost)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}

      {/* Создать товар */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Новый товар</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateItem} className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="space-y-1.5">
              <Label>Наименование *</Label>
              <Input name="name" required placeholder="Канцтовары, бумага A4..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Единица измерения</Label>
                <Input name="unit" defaultValue="шт" />
              </div>
              <div className="space-y-1.5">
                <Label>Стоимость за ед. (по умолчанию)</Label>
                <Input name="defaultUnitCost" type="number" step="0.01" min="0" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={saving}>{saving ? "..." : "Создать"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Закупка */}
      <Dialog open={purchaseOpen} onOpenChange={setPurchaseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Закупка товара</DialogTitle></DialogHeader>
          <form onSubmit={handlePurchase} className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="space-y-1.5">
              <Label>Товар *</Label>
              <Select name="stockItemId" required>
                <SelectTrigger className="w-full">Выберите товар</SelectTrigger>
                <SelectContent>
                  {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Филиал (склад) *</Label>
              <Select name="branchId" required>
                <SelectTrigger className="w-full">Выберите филиал</SelectTrigger>
                <SelectContent>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Количество *</Label>
                <Input name="quantity" type="number" step="0.001" min="0.001" required />
              </div>
              <div className="space-y-1.5">
                <Label>Стоимость за ед. *</Label>
                <Input name="unitCost" type="number" step="0.01" min="0" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Амортизация (мес.)</Label>
              <Input name="amortizationMonths" type="number" min="1" placeholder="Оставьте пустым если без амортизации" />
            </div>
            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Input name="comment" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPurchaseOpen(false)}>Отмена</Button>
              <Button type="submit" disabled={saving}>{saving ? "..." : "Оформить закупку"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
