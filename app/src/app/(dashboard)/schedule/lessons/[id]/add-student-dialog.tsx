"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { UserPlus, Loader2, ArrowLeft, AlertCircle, Wallet, BookOpen } from "lucide-react"

type StudentResult = {
  clientId: string
  clientName: string
  clientPhone: string | null
  clientBalance: number
  wardId: string
  wardName: string
  subscription: { id: string; balance: number; lessonPrice: number } | null
}

interface AddStudentDialogProps {
  lessonId: string
  /** Стоимость разового посещения для направления группы (₽). */
  singleVisitPrice: number
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

export function AddStudentDialog({ lessonId, singleVisitPrice }: AddStudentDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<"search" | "source">("search")

  const [search, setSearch] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<StudentResult[]>([])
  const [selected, setSelected] = useState<StudentResult | null>(null)

  const [source, setSource] = useState<"subscription" | "balance">("subscription")
  const [amount, setAmount] = useState<string>(String(singleVisitPrice || 0))
  const [isOneTime, setIsOneTime] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep("search")
    setSearch("")
    setResults([])
    setSelected(null)
    setSource("subscription")
    setAmount(String(singleVisitPrice || 0))
    setIsOneTime(false)
    setError(null)
  }

  // Поиск
  useEffect(() => {
    if (step !== "search") return
    const q = search.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/lessons/${lessonId}/add-student/search?q=${encodeURIComponent(q)}`,
        )
        if (!cancelled && res.ok) {
          setResults(await res.json())
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [search, step, lessonId])

  // При выборе ученика: если есть активный абонемент — по умолчанию source=subscription;
  // если нет — переключаемся на balance (subscription становится недоступным).
  function pickStudent(s: StudentResult) {
    setSelected(s)
    if (s.subscription) {
      setSource("subscription")
    } else {
      setSource("balance")
    }
    setStep("source")
  }

  async function submit() {
    if (!selected) return
    setSubmitting(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        clientId: selected.clientId,
        wardId: selected.wardId,
        source,
        isOneTime,
      }
      if (source === "subscription" && selected.subscription) {
        body.subscriptionId = selected.subscription.id
      }
      if (source === "balance") {
        const n = Number(amount)
        if (!isFinite(n) || n < 0) {
          setError("Некорректная стоимость")
          setSubmitting(false)
          return
        }
        body.amount = n
      }
      const res = await fetch(`/api/lessons/${lessonId}/add-student`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось добавить ученика")
        return
      }
      setOpen(false)
      reset()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmitSource =
    !!selected &&
    (source === "subscription"
      ? !!selected.subscription && selected.subscription.balance > 0
      : amount !== "" && Number(amount) >= 0)

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <UserPlus className="mr-2 size-4" />
        Добавить ученика
      </DialogTrigger>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {step === "search" ? "Выберите ученика" : "Источник списания"}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === "search" && (
          <div className="space-y-3">
            <Input
              placeholder="Поиск по ФИО ребёнка или родителя, телефону..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {searching && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Поиск...
              </div>
            )}
            {!searching && search.length >= 2 && results.length === 0 && (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Ничего не найдено
              </div>
            )}
            {results.length > 0 && (
              <div className="max-h-[320px] space-y-2 overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={`${r.clientId}-${r.wardId || ""}`}
                    type="button"
                    onClick={() => pickStudent(r)}
                    className="flex w-full items-start justify-between rounded-lg border p-3 text-left hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{r.wardName}</div>
                      {r.wardName !== r.clientName && (
                        <div className="text-xs text-muted-foreground">
                          Родитель: {r.clientName}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Wallet className="size-3" />
                          Баланс: {formatMoney(r.clientBalance)}
                        </span>
                        {r.subscription ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600">
                            <BookOpen className="size-3" />
                            Абонемент: {formatMoney(r.subscription.balance)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/70">без абонемента</span>
                        )}
                      </div>
                    </div>
                    <span className="ml-2 text-xs text-primary shrink-0">Выбрать →</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "source" && selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{selected.wardName}</div>
                {selected.wardName !== selected.clientName && (
                  <div className="text-xs text-muted-foreground">
                    Родитель: {selected.clientName}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep("search")
                  setSelected(null)
                  setError(null)
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3" />
                Другой
              </button>
            </div>

            <div className="space-y-2">
              <Label>Источник списания</Label>
              <div className="space-y-2">
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${
                    source === "subscription" ? "border-primary bg-primary/5" : ""
                  } ${!selected.subscription ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <input
                    type="radio"
                    name="source"
                    className="mt-1"
                    checked={source === "subscription"}
                    disabled={!selected.subscription}
                    onChange={() => setSource("subscription")}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Абонемент</div>
                    {selected.subscription ? (
                      <div className="text-xs text-muted-foreground">
                        Остаток: {formatMoney(selected.subscription.balance)} • Цена занятия:{" "}
                        {formatMoney(selected.subscription.lessonPrice)}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Нет активного абонемента на эту группу/период
                      </div>
                    )}
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 ${
                    source === "balance" ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="source"
                    className="mt-1"
                    checked={source === "balance"}
                    onChange={() => setSource("balance")}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Баланс родителя</div>
                    <div className="text-xs text-muted-foreground">
                      Текущий баланс: {formatMoney(selected.clientBalance)}
                      {Number(amount) > selected.clientBalance && (
                        <span className="ml-2 text-amber-600">
                          (уйдёт в минус на{" "}
                          {formatMoney(Number(amount) - selected.clientBalance)})
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {source === "balance" && (
              <div className="space-y-1.5">
                <Label htmlFor="add-amount">Стоимость, ₽</Label>
                <Input
                  id="add-amount"
                  type="number"
                  min={0}
                  step={50}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="text-xs text-muted-foreground">
                  По умолчанию — цена разового посещения направления.
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={isOneTime}
                onCheckedChange={(v) => setIsOneTime(v === true)}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium">Разовое посещение</div>
                <div className="text-xs text-muted-foreground">
                  Без зачисления в группу. Если выключено — ребёнок добавится в группу как
                  постоянный участник.
                </div>
              </div>
            </label>
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Отмена
          </DialogClose>
          {step === "source" && (
            <Button onClick={submit} disabled={submitting || !canSubmitSource}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Добавление...
                </>
              ) : (
                "Добавить"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
