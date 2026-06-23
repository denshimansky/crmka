"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import type { Loc } from "@/components/move-stock-dialog"

export interface WriteOffSource {
  stockItemId: string
  itemName: string
  unit: string
  available: number
  unitCost: number
  from: Loc
  fromLabel: string
  branchId?: string // филиал источника — для предвыбора в «Филиалы»
}

export interface WriteOffCategory { id: string; name: string; isVariable: boolean }
export interface WriteOffBranch { id: string; name: string }
export interface WriteOffDirection { id: string; name: string }

type RecognitionMode = "by_payment_date" | "single_period" | "amortized"

const NONE_VALUE = "__none__"
const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]

function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m || m < 1 || m > 12) return yyyymm
  return `${MONTH_NAMES[m - 1]} ${y}`
}
function shiftMonth(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split("-").map(Number)
  if (!y || !m) return yyyymm
  const k = y * 12 + (m - 1) + delta
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`
}
function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount) + " ₽"
}

// «Списание товара» — форма как «Новый расход», но без счёта (расход идёт только в
// ОПИУ, не в ДДС) и без режима «Не учитывать в финрезе». Сумма = кол-во × себестоимость.
export function WriteOffStockDialog({
  source,
  categories,
  branches,
  directions,
  onClose,
  onDone,
}: {
  source: WriteOffSource | null
  categories: WriteOffCategory[]
  branches: WriteOffBranch[]
  directions: WriteOffDirection[]
  onClose: () => void
  onDone: () => void
}) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const todayMonth = todayIso.slice(0, 7)

  const [categoryId, setCategoryId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [date, setDate] = useState(todayIso)
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [directionId, setDirectionId] = useState("")
  const [comment, setComment] = useState("")
  const [recognitionMode, setRecognitionMode] = useState<RecognitionMode>("by_payment_date")
  const [singleMonth, setSingleMonth] = useState(todayMonth)
  const [amortStartMonth, setAmortStartMonth] = useState(todayMonth)
  const [amortMonths, setAmortMonths] = useState("3")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Сброс при открытии/смене источника; «Канцтовары» — статья по умолчанию, если есть.
  useEffect(() => {
    const stockCat = categories.find((c) => /канцтовар/i.test(c.name))
    setCategoryId(stockCat?.id ?? "")
    setQuantity("")
    setDate(todayIso)
    setSelectedBranches(source?.branchId ? [source.branchId] : [])
    setDirectionId("")
    setComment("")
    setRecognitionMode("by_payment_date")
    setSingleMonth(todayMonth)
    setAmortStartMonth(todayMonth)
    setAmortMonths("3")
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  if (!source) return null

  function toggleBranch(branchId: string) {
    setSelectedBranches((prev) => prev.includes(branchId) ? prev.filter((b) => b !== branchId) : [...prev, branchId])
  }

  const qtyNum = Number(quantity) || 0
  const previewAmount = qtyNum > 0 ? Math.round(qtyNum * source.unitCost * 100) / 100 : 0
  const selectedCategory = categories.find((c) => c.id === categoryId)
  const selectedDirection = directions.find((d) => d.id === directionId)
  const amortN = Math.max(2, Math.min(60, Number(amortMonths) || 0))
  const amortPerMonth = previewAmount > 0 && amortN > 0 ? previewAmount / amortN : 0
  const amortEndMonth = shiftMonth(amortStartMonth, amortN - 1)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!source) return
    if (!categoryId) { setError("Выберите статью расхода"); return }
    if (!quantity || qtyNum <= 0) { setError("Укажите количество"); return }
    if (qtyNum > source.available) { setError(`Недостаточно: доступно ${source.available} ${source.unit}`); return }
    if (!date) { setError("Укажите дату списания"); return }

    let amortizationStartDate: string | undefined
    let amortizationMonths: number | undefined
    if (recognitionMode === "single_period") {
      amortizationStartDate = `${singleMonth}-01`
      amortizationMonths = 1
    } else if (recognitionMode === "amortized") {
      if (!Number.isFinite(amortN) || amortN < 2 || amortN > 60) { setError("Месяцев должно быть от 2 до 60"); return }
      amortizationStartDate = `${amortStartMonth}-01`
      amortizationMonths = amortN
    }

    setSaving(true)
    const res = await fetch("/api/stock-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "write_off",
        stockItemId: source.stockItemId,
        from: source.from,
        quantity: qtyNum,
        categoryId,
        date,
        branchIds: selectedBranches,
        directionId: directionId || null,
        recognitionMode,
        amortizationStartDate,
        amortizationMonths,
        comment: comment || undefined,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Не удалось списать товар")
      setSaving(false)
      return
    }
    setSaving(false)
    onDone()
    onClose()
  }

  return (
    <Dialog open={!!source} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Списание товара</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Товар</Label>
              <p className="text-sm font-medium">{source.itemName} <span className="text-muted-foreground">({source.unit})</span></p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Откуда</Label>
              <p className="text-sm font-medium">{source.fromLabel}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Статья расхода *</Label>
            <Select value={categoryId} onValueChange={(v) => { if (v) setCategoryId(v) }}>
              <SelectTrigger className="w-full">{selectedCategory ? selectedCategory.name : "Выберите статью"}</SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Кол-во на списание * <span className="text-muted-foreground text-xs">(из {source.available})</span></Label>
              <Input type="number" step="0.001" min="0.001" max={source.available} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Дата списания *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Сумма списания ≈ {formatMoney(previewAmount)} (кол-во × себестоимость). Расход идёт в ОПИУ, в ДДС не попадает (деньги не двигаются).
          </p>

          {branches.length > 0 && (
            <div className="space-y-1.5">
              <Label>Филиалы</Label>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => (
                  <label key={b.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={selectedBranches.includes(b.id)} onCheckedChange={() => toggleBranch(b.id)} />
                    {b.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedBranches.length === 0 ? "Не выбрано — распределится по выручке" : `Выбрано: ${selectedBranches.length}`}
              </p>
            </div>
          )}

          {directions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Направление</Label>
              <Select value={directionId || NONE_VALUE} onValueChange={(v) => setDirectionId(!v || v === NONE_VALUE ? "" : v)}>
                <SelectTrigger className="w-full">
                  {selectedDirection ? selectedDirection.name : "Не указано (распределить по выручке)"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Не указано —</SelectItem>
                  {directions.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Необязательно" />
          </div>

          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Как провести в ОПИУ</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="wo-recognition" className="mt-1" checked={recognitionMode === "by_payment_date"} onChange={() => setRecognitionMode("by_payment_date")} />
              <span>
                <span className="font-medium">Одной суммой по дате списания</span>
                <span className="block text-xs text-muted-foreground">Расход относится к месяцу даты списания.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="wo-recognition" className="mt-1" checked={recognitionMode === "single_period"} onChange={() => setRecognitionMode("single_period")} />
              <span className="flex-1">
                <span className="font-medium">Одной суммой в другом месяце</span>
                {recognitionMode === "single_period" && (
                  <div className="mt-2 space-y-1.5">
                    <Label className="text-xs">Месяц признания</Label>
                    <Input type="month" value={singleMonth} onChange={(e) => setSingleMonth(e.target.value)} />
                  </div>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="wo-recognition" className="mt-1" checked={recognitionMode === "amortized"} onChange={() => setRecognitionMode("amortized")} />
              <span className="flex-1">
                <span className="font-medium">Разделить на N месяцев</span>
                {recognitionMode === "amortized" && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Начиная с</Label>
                      <Input type="month" value={amortStartMonth} onChange={(e) => setAmortStartMonth(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Месяцев</Label>
                      <Input type="number" min="2" max="60" value={amortMonths} onChange={(e) => setAmortMonths(e.target.value)} />
                    </div>
                    {amortPerMonth > 0 && (
                      <p className="col-span-2 text-xs text-muted-foreground">
                        {formatMonth(amortStartMonth)} — {formatMonth(amortEndMonth)} (по {formatMoney(amortPerMonth)}/мес)
                      </p>
                    )}
                  </div>
                )}
              </span>
            </label>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" variant="destructive" disabled={saving}>{saving ? "Списание..." : "Списать"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
