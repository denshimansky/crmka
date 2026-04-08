"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Plus, Pencil, TrendingDown, Target, BarChart3, ChevronLeft, ChevronRight } from "lucide-react"
import { PageHelp } from "@/components/page-help"

const MONTH_NAMES = [
  "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]

interface PlannedExpense {
  id: string
  year: number
  month: number
  categoryId: string
  categoryName: string
  plannedAmount: number
  actualAmount: number
  comment: string | null
}

interface Category {
  id: string
  name: string
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

export default function PlannedExpensesPage() {
  const router = useRouter()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [items, setItems] = useState<PlannedExpense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editItem, setEditItem] = useState<PlannedExpense | null>(null)
  const [formCategoryId, setFormCategoryId] = useState("")
  const [formPlannedAmount, setFormPlannedAmount] = useState("")
  const [formComment, setFormComment] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [itemsRes, catsRes] = await Promise.all([
        fetch(`/api/planned-expenses?year=${year}&month=${month}`),
        fetch("/api/expense-categories"),
      ])
      if (itemsRes.ok) setItems(await itemsRes.json())
      if (catsRes.ok) setCategories(await catsRes.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [year, month])

  useEffect(() => { loadData() }, [loadData])

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  function openCreate() {
    setEditItem(null)
    setFormCategoryId("")
    setFormPlannedAmount("")
    setFormComment("")
    setError(null)
    setDialogOpen(true)
  }

  function openEdit(item: PlannedExpense) {
    setEditItem(item)
    setFormCategoryId(item.categoryId)
    setFormPlannedAmount(String(item.plannedAmount))
    setFormComment(item.comment || "")
    setError(null)
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!formCategoryId) {
      setError("Выберите категорию")
      return
    }
    if (!formPlannedAmount || Number(formPlannedAmount) <= 0) {
      setError("Укажите плановую сумму")
      return
    }

    setSaving(true)
    setError(null)

    try {
      const url = editItem
        ? `/api/planned-expenses/${editItem.id}`
        : "/api/planned-expenses"
      const method = editItem ? "PATCH" : "POST"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year,
          month,
          categoryId: formCategoryId,
          plannedAmount: Number(formPlannedAmount),
          comment: formComment.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }

      setDialogOpen(false)
      loadData()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  // Summary
  const totalPlanned = items.reduce((sum, i) => sum + i.plannedAmount, 0)
  const totalActual = items.reduce((sum, i) => sum + i.actualAmount, 0)
  const deviation = totalActual - totalPlanned
  const deviationPercent = totalPlanned > 0 ? ((deviation / totalPlanned) * 100).toFixed(1) : "0"

  const summaryCards = [
    { title: "План", value: formatMoney(totalPlanned), icon: Target, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "Факт", value: formatMoney(totalActual), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
    {
      title: "Отклонение",
      value: `${deviation >= 0 ? "+" : ""}${formatMoney(deviation)} (${deviationPercent}%)`,
      icon: BarChart3,
      color: deviation > 0 ? "text-red-600" : "text-green-600",
      bg: deviation > 0 ? "bg-red-50" : "bg-green-50",
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Плановые расходы</h1>
            <PageHelp pageKey="finance/planned-expenses" />
          </div>
          <p className="text-sm text-muted-foreground">
            План vs факт по статьям расходов
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 size-4" />
          Добавить план
        </Button>
      </div>

      {/* Month navigation */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={prevMonth}>
          <ChevronLeft className="size-4" />
        </Button>
        <Badge variant="outline" className="text-sm px-3 py-1">
          {MONTH_NAMES[month]} {year}
        </Badge>
        <Button variant="outline" size="icon" onClick={nextMonth}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        {summaryCards.map(s => (
          <Card key={s.title}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className={`flex size-10 items-center justify-center rounded-lg ${s.bg}`}>
                <s.icon className={`size-5 ${s.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{s.title}</p>
                <p className="text-lg font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12 text-muted-foreground">
            Загрузка...
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <p>Нет плановых расходов за {MONTH_NAMES[month]} {year}</p>
            <p className="text-xs">Добавьте план расходов по категориям</p>
          </CardContent>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Категория</TableHead>
              <TableHead className="text-right">План</TableHead>
              <TableHead className="text-right">Факт</TableHead>
              <TableHead className="text-right">Отклонение</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead>Комментарий</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => {
              const diff = item.actualAmount - item.plannedAmount
              const pct = item.plannedAmount > 0
                ? ((diff / item.plannedAmount) * 100).toFixed(1)
                : "—"
              const isOver = diff > 0
              const isUnder = diff < 0

              return (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.categoryName}</TableCell>
                  <TableCell className="text-right">{formatMoney(item.plannedAmount)}</TableCell>
                  <TableCell className="text-right">{formatMoney(item.actualAmount)}</TableCell>
                  <TableCell className={`text-right font-medium ${isOver ? "text-red-600" : isUnder ? "text-green-600" : ""}`}>
                    {diff === 0 ? "—" : `${diff > 0 ? "+" : ""}${formatMoney(diff)}`}
                  </TableCell>
                  <TableCell className={`text-right ${isOver ? "text-red-600" : isUnder ? "text-green-600" : ""}`}>
                    {pct === "—" ? "—" : `${Number(pct) > 0 ? "+" : ""}${pct}%`}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-[150px] truncate">
                    {item.comment || "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEdit(item)}
                    >
                      <Pencil className="size-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}

            {/* Total row */}
            <TableRow className="font-bold bg-muted/50">
              <TableCell>Итого</TableCell>
              <TableCell className="text-right">{formatMoney(totalPlanned)}</TableCell>
              <TableCell className="text-right">{formatMoney(totalActual)}</TableCell>
              <TableCell className={`text-right ${deviation > 0 ? "text-red-600" : deviation < 0 ? "text-green-600" : ""}`}>
                {deviation === 0 ? "—" : `${deviation > 0 ? "+" : ""}${formatMoney(deviation)}`}
              </TableCell>
              <TableCell className={`text-right ${deviation > 0 ? "text-red-600" : deviation < 0 ? "text-green-600" : ""}`}>
                {deviationPercent}%
              </TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      )}

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editItem ? "Редактировать план" : "Новый план расхода"}
            </DialogTitle>
            <DialogDescription>
              {MONTH_NAMES[month]} {year}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label>Категория</Label>
              <Select
                value={formCategoryId}
                onValueChange={(v) => { if (v) setFormCategoryId(v) }}
                disabled={!!editItem}
              >
                <SelectTrigger className="w-full">
                  {formCategoryId
                    ? categories.find(c => c.id === formCategoryId)?.name || "Выберите"
                    : <span className="text-muted-foreground">Выберите категорию</span>
                  }
                </SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Плановая сумма</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="50000"
                value={formPlannedAmount}
                onChange={(e) => setFormPlannedAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Комментарий</Label>
              <Input
                placeholder="Доп. информация"
                value={formComment}
                onChange={(e) => setFormComment(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Сохранение..." : editItem ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
