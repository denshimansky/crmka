"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Plus } from "lucide-react"
import { useCurrencySymbol } from "@/components/currency-provider"
import { OpiuRecognitionFieldset, type OpiuRecognitionState } from "@/components/opiu-recognition-fieldset"
import { resolveRecognition } from "@/lib/expense-recognition"

interface CategoryOption {
  id: string
  name: string
  isVariable: boolean
}

interface AccountOption {
  id: string
  name: string
}

interface BranchOption {
  id: string
  name: string
}

interface DirectionOption {
  id: string
  name: string
  // Список филиалов, в которых у этого направления есть группы.
  branchIds: string[]
}

interface LeadChannelOption {
  id: string
  name: string
}

const MARKETING_CATEGORY_NAME = "Маркетинг и реклама"
const NONE_VALUE = "__none__"

export function AddExpenseDialog({
  categories,
  accounts,
  branches,
  directions,
  leadChannels,
}: {
  categories: CategoryOption[]
  accounts: AccountOption[]
  branches: BranchOption[]
  directions: DirectionOption[]
  leadChannels: LeadChannelOption[]
}) {
  const router = useRouter()
  const sym = useCurrencySymbol()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const todayIso = new Date().toISOString().slice(0, 10)
  const todayMonth = todayIso.slice(0, 7)

  const [categoryId, setCategoryId] = useState("")
  const [accountId, setAccountId] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(todayIso)
  const [comment, setComment] = useState("")
  const [isRecurring, setIsRecurring] = useState(false)
  const [opiu, setOpiu] = useState<OpiuRecognitionState>({
    recognitionMode: "by_payment_date", singleMonth: todayMonth, amortStartMonth: todayMonth, amortMonths: "3",
  })
  const [selectedBranches, setSelectedBranches] = useState<string[]>([])
  const [directionId, setDirectionId] = useState<string>("")
  const [leadChannelId, setLeadChannelId] = useState<string>("")

  function reset() {
    setCategoryId("")
    setAccountId("")
    setAmount("")
    setDate(todayIso)
    setComment("")
    setIsRecurring(false)
    setOpiu({ recognitionMode: "by_payment_date", singleMonth: todayMonth, amortStartMonth: todayMonth, amortMonths: "3" })
    setSelectedBranches([])
    setDirectionId("")
    setLeadChannelId("")
    setError(null)
  }

  function toggleBranch(branchId: string) {
    setSelectedBranches(prev => {
      const next = prev.includes(branchId)
        ? prev.filter(b => b !== branchId)
        : [...prev, branchId]
      // Если выбранное направление больше не доступно в новых филиалах — сбросим.
      if (directionId) {
        const dir = directions.find((d) => d.id === directionId)
        const stillAvailable =
          next.length === 0 || (dir && dir.branchIds.some((bid) => next.includes(bid)))
        if (!stillAvailable) setDirectionId("")
      }
      return next
    })
  }

  function changeCategory(newCategoryId: string) {
    setCategoryId(newCategoryId)
    // Канал привлечения имеет смысл только для «Маркетинг и реклама».
    const cat = categories.find((c) => c.id === newCategoryId)
    if (cat?.name !== MARKETING_CATEGORY_NAME && leadChannelId) {
      setLeadChannelId("")
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!categoryId) { setError("Выберите статью расхода"); return }
    if (!accountId) { setError("Выберите счёт"); return }
    if (!amount || Number(amount) <= 0) { setError("Укажите сумму"); return }
    if (!date) { setError("Укажите дату"); return }

    let recognitionPayload
    try {
      recognitionPayload = resolveRecognition(opiu)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка признания")
      return
    }
    const { recognitionMode, amortizationStartDate, amortizationMonths } = recognitionPayload

    const selectedCategory = categories.find(c => c.id === categoryId)
    const isMarketing = selectedCategory?.name === MARKETING_CATEGORY_NAME

    setLoading(true)
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          accountId,
          amount: Number(amount),
          date,
          comment: comment || undefined,
          isVariable: selectedCategory?.isVariable ?? false,
          isRecurring,
          recognitionMode,
          amortizationStartDate,
          amortizationMonths,
          branchIds: selectedBranches,
          directionId: directionId || null,
          leadChannelId: isMarketing && leadChannelId ? leadChannelId : null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании расхода")
        return
      }

      reset()
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  const selectedCategory = categories.find(c => c.id === categoryId)
  const selectedAccount = accounts.find(a => a.id === accountId)
  const isMarketing = selectedCategory?.name === MARKETING_CATEGORY_NAME

  // Направления, доступные в выбранных филиалах (если не выбрано — показываем все).
  const availableDirections =
    selectedBranches.length === 0
      ? directions
      : directions.filter((d) =>
          d.branchIds.some((bid) => selectedBranches.includes(bid)),
        )
  const selectedDirection = availableDirections.find((d) => d.id === directionId)
  const selectedChannel = leadChannels.find((c) => c.id === leadChannelId)

  // Если филиалы изменились и текущее направление в них не доступно — сбросим.
  // (делаем в обработчике filter снизу, чтобы не вводить лишний useEffect)

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-2 size-4" />
        Внести расход
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый расход</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Статья расхода *</Label>
            <Select value={categoryId} onValueChange={(v) => { if (v) changeCategory(v) }}>
              <SelectTrigger className="w-full">
                {selectedCategory ? selectedCategory.name : "Выберите статью"}
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Сумма *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Дата платежа *</Label>
              <Input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Счёт *</Label>
            <Select value={accountId} onValueChange={(v) => { if (v) setAccountId(v) }}>
              <SelectTrigger className="w-full">
                {selectedAccount ? selectedAccount.name : "Выберите счёт"}
              </SelectTrigger>
              <SelectContent>
                {accounts.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {branches.length > 1 && (
            <div className="space-y-1.5">
              <Label>Филиалы</Label>
              <div className="flex flex-wrap gap-2">
                {branches.map(b => (
                  <label key={b.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={selectedBranches.includes(b.id)}
                      onCheckedChange={() => toggleBranch(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedBranches.length === 0 ? "Все филиалы" : `Выбрано: ${selectedBranches.length}`}
              </p>
            </div>
          )}

          {availableDirections.length > 0 && (
            <div className="space-y-1.5">
              <Label>Направление</Label>
              <Select
                value={directionId || NONE_VALUE}
                onValueChange={(v) => setDirectionId(!v || v === NONE_VALUE ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  {selectedDirection ? selectedDirection.name : "Не указано (распределить по выручке)"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Не указано —</SelectItem>
                  {availableDirections.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Если указано — расход относится напрямую к направлению в ОПИУ. Иначе распределяется пропорционально выручке.
              </p>
            </div>
          )}

          {isMarketing && (
            <div className="space-y-1.5">
              <Label>Канал привлечения</Label>
              <Select
                value={leadChannelId || NONE_VALUE}
                onValueChange={(v) => setLeadChannelId(!v || v === NONE_VALUE ? "" : v)}
              >
                <SelectTrigger className="w-full">
                  {selectedChannel ? selectedChannel.name : "Не указан"}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Не указан —</SelectItem>
                  {leadChannels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Канал, на который потрачен бюджет (для отчёта эффективности маркетинга).
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Input
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Необязательно"
            />
          </div>

          {/* Чекбокс «Повторяющийся» временно скрыт — нет настоящей автоматики,
              есть только ручное копирование между месяцами. Возвращаем, когда
              появится крон-генерация. Состояние оставляем (isRecurring=false по умолчанию). */}

          {/* Блок «Как провести в ОПИУ» */}
          <OpiuRecognitionFieldset value={opiu} onChange={setOpiu} amount={Number(amount) || 0} sym={sym} />

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохранение..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
