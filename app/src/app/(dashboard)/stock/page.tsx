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
import { PackagePlus, ArrowRight, Package } from "lucide-react"
import Link from "next/link"
import { PageHelp } from "@/components/page-help"

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

interface Account {
  id: string
  name: string
}

interface Category {
  id: string
  name: string
  isSalary: boolean
}

function formatMoney(v: number) {
  return new Intl.NumberFormat("ru-RU").format(v) + " ₽"
}

// Категория расхода, на которую закупка проводится в ОПИУ (см. API stock-movements).
const STOCK_CATEGORY_LABEL = "Канцтовары и расходники"

export default function StockPage() {
  const [balances, setBalances] = useState<StockBalance[]>([])
  const [items, setItems] = useState<StockItem[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Поля формы «Внести на склад»
  const [itemName, setItemName] = useState("")
  const [unit, setUnit] = useState("шт")
  const [unitCost, setUnitCost] = useState("")
  const [quantity, setQuantity] = useState("")
  const [branchId, setBranchId] = useState("")
  const [accountId, setAccountId] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [amortMonths, setAmortMonths] = useState("")
  const [comment, setComment] = useState("")

  const load = useCallback(async () => {
    const [balRes, itemRes, brRes, accRes, catRes] = await Promise.all([
      fetch("/api/stock-balances"),
      fetch("/api/stock-items"),
      fetch("/api/branches"),
      fetch("/api/accounts"),
      fetch("/api/expense-categories"),
    ])
    if (balRes.ok) setBalances(await balRes.json())
    if (itemRes.ok) setItems(await itemRes.json())
    if (brRes.ok) setBranches(await brRes.json())
    if (accRes.ok) setAccounts(await accRes.json())
    if (catRes.ok) {
      const cats: Category[] = await catRes.json()
      // Закупка товаров — не зарплата; статьи ЗП в выборе не нужны.
      setCategories(cats.filter((c) => !c.isSalary))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const defaultCategoryId = categories.find((c) => c.name === STOCK_CATEGORY_LABEL)?.id ?? ""

  function resetForm() {
    setItemName(""); setUnit("шт"); setUnitCost(""); setQuantity("")
    setBranchId(""); setAccountId(""); setCategoryId(defaultCategoryId)
    setAmortMonths(""); setComment("")
    setError(null)
  }

  // Если введённое имя совпадает с существующим товаром — подставляем его
  // единицу/цену и шлём по id; иначе создаём новый товар на лету.
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
    if (!unitCost || Number(unitCost) < 0) { setError("Укажите стоимость за единицу"); return }
    if (!branchId) { setError("Выберите филиал (склад)"); return }
    if (!accountId) { setError("Выберите счёт оплаты"); return }

    setSaving(true)
    const res = await fetch("/api/stock-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "purchase",
        ...(matchedItem ? { stockItemId: matchedItem.id } : { itemName: itemName.trim(), unit: unit.trim() || "шт" }),
        branchId,
        accountId,
        categoryId: categoryId || undefined,
        quantity: Number(quantity),
        unitCost: Number(unitCost),
        amortizationMonths: Number(amortMonths) || undefined,
        comment: comment || undefined,
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

  // Группировка по филиалу
  const grouped = balances.reduce<Record<string, StockBalance[]>>((acc, b) => {
    const key = b.branch.name
    if (!acc[key]) acc[key] = []
    acc[key].push(b)
    return acc
  }, {})

  const totalItems = balances.reduce((sum, b) => sum + Number(b.quantity), 0)
  const totalCost = balances.reduce((sum, b) => sum + Number(b.totalCost), 0)

  const previewSum = Number(quantity) > 0 && Number(unitCost) >= 0
    ? Number(quantity) * Number(unitCost)
    : 0

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
              <ArrowRight className="size-4 mr-1" /> Перемещения
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
            Склад пуст. Нажмите «Внести на склад» — товар появится здесь.
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([branchName, list]) => (
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
                  {list.map(b => {
                    const qty = Number(b.quantity)
                    const cost = Number(b.totalCost)
                    const perUnit = qty > 0 ? cost / qty : 0
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.stockItem.name} <span className="text-muted-foreground text-xs">({b.stockItem.unit})</span></TableCell>
                        <TableCell className="text-right">{qty}</TableCell>
                        <TableCell className="text-right">{formatMoney(perUnit)}</TableCell>
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

      {/* Внести на склад (закупка) */}
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Филиал (склад) *</Label>
                <Select value={branchId} onValueChange={(v) => { if (v) setBranchId(v) }}>
                  <SelectTrigger className="w-full">
                    {branches.find(b => b.id === branchId)?.name ?? "Выберите филиал"}
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Счёт оплаты *</Label>
                <Select value={accountId} onValueChange={(v) => { if (v) setAccountId(v) }}>
                  <SelectTrigger className="w-full">
                    {accounts.find(a => a.id === accountId)?.name ?? "Выберите счёт"}
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Статья расхода</Label>
                <Select value={categoryId} onValueChange={(v) => { if (v) setCategoryId(v) }}>
                  <SelectTrigger className="w-full">
                    {categories.find(c => c.id === categoryId)?.name ?? "Выберите статью"}
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Амортизация (мес.)</Label>
                <Input type="number" min="2" max="60" value={amortMonths} onChange={(e) => setAmortMonths(e.target.value)} placeholder="Пусто — сразу" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} />
            </div>

            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              На сумму {formatMoney(previewSum)} будет создан расход «{categories.find(c => c.id === categoryId)?.name ?? STOCK_CATEGORY_LABEL}» со счёта (ДДС{amortMonths && Number(amortMonths) >= 2 ? `, в ОПИУ — по ${amortMonths} мес.` : " и ОПИУ сразу"}). Затем товар можно переместить в кабинеты.
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
