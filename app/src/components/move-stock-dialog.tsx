"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"

// Локация товара: общий склад (без id) | филиал | кабинет.
export type Loc = { kind: "warehouse" } | { kind: "branch"; id: string } | { kind: "room"; id: string }

// Источник перемещения — формируется из строки, по которой кликнули (товар + где он лежит).
export interface MoveSource {
  stockItemId: string
  itemName: string
  unit: string
  available: number
  from: Loc
  fromLabel: string
}

export interface MoveBranch {
  id: string
  name: string
  rooms: { id: string; name: string }[]
}

// Сентинел «Без кабинета» (base-ui Select не любит пустую строку как значение пункта).
const NO_ROOM = "__none__"
// Сентинел «Склад» в выборе филиала.
const WAREHOUSE = "__warehouse__"

function sameLoc(a: Loc, b: Loc): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "warehouse" || b.kind === "warehouse") return a.kind === b.kind
  return a.id === b.id
}

// Диалог «Переместить товар». Товар и «Откуда» приходят из источника (read-only),
// «Куда» выбирается в два шага: филиал (первым пунктом СКЛАД) → кабинет (первым
// пунктом «Без кабинета» — тогда перемещаем в филиал целиком).
export function MoveStockDialog({
  source,
  branches,
  onClose,
  onMoved,
}: {
  source: MoveSource | null
  branches: MoveBranch[]
  onClose: () => void
  onMoved: () => void
}) {
  const [branchSel, setBranchSel] = useState("") // "" | WAREHOUSE | branchId
  const [roomSel, setRoomSel] = useState(NO_ROOM) // NO_ROOM | roomId
  const [qty, setQty] = useState("")
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Сброс формы при открытии / смене источника.
  useEffect(() => {
    setBranchSel("")
    setRoomSel(NO_ROOM)
    setQty("")
    setComment("")
    setError(null)
  }, [source])

  if (!source) return null

  const selectedBranch = branches.find((b) => b.id === branchSel)
  const showRoom = branchSel !== "" && branchSel !== WAREHOUSE

  function resolveTo(): Loc | null {
    if (branchSel === WAREHOUSE) return { kind: "warehouse" }
    if (selectedBranch) {
      if (roomSel !== NO_ROOM) return { kind: "room", id: roomSel }
      return { kind: "branch", id: selectedBranch.id }
    }
    return null
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!source) return
    const to = resolveTo()
    if (!to) {
      setError("Выберите, куда переместить")
      return
    }
    if (sameLoc(source.from, to)) {
      setError("Источник и приёмник совпадают")
      return
    }
    if (!qty || Number(qty) <= 0) {
      setError("Укажите количество")
      return
    }
    if (Number(qty) > source.available) {
      setError(`Недостаточно: доступно ${source.available} ${source.unit}`)
      return
    }

    setSaving(true)
    const res = await fetch("/api/stock-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "transfer",
        stockItemId: source.stockItemId,
        from: source.from,
        to,
        quantity: Number(qty),
        comment: comment || undefined,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Не удалось переместить товар")
      setSaving(false)
      return
    }
    setSaving(false)
    onMoved()
    onClose()
  }

  return (
    <Dialog open={!!source} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Переместить товар</DialogTitle></DialogHeader>
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
            <Label>Куда: филиал *</Label>
            <Select value={branchSel} onValueChange={(v) => { if (v) { setBranchSel(v); setRoomSel(NO_ROOM) } }}>
              <SelectTrigger className="w-full">
                {branchSel === WAREHOUSE ? "Склад" : (selectedBranch?.name ?? "Выберите склад или филиал")}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WAREHOUSE}>Склад</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {showRoom && (
            <div className="space-y-1.5">
              <Label>Куда: кабинет</Label>
              <Select value={roomSel} onValueChange={(v) => { if (v) setRoomSel(v) }}>
                <SelectTrigger className="w-full">
                  {roomSel === NO_ROOM ? "Без кабинета" : (selectedBranch?.rooms.find((r) => r.id === roomSel)?.name ?? "Без кабинета")}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROOM}>Без кабинета</SelectItem>
                  {selectedBranch?.rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Не выбран — переместим в филиал целиком.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Количество * (доступно {source.available} {source.unit})</Label>
            <Input type="number" step="0.001" min="0.001" max={source.available} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={saving}>{saving ? "..." : "Переместить"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
