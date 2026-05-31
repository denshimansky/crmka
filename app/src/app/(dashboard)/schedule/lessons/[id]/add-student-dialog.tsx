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
import { Checkbox } from "@/components/ui/checkbox"
import { UserPlus, Loader2, AlertCircle, Wallet, BookOpen } from "lucide-react"

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
  /** Группа занятия — скрытая разовая (isOneTime=true) или обычная.
   *  Для разовой группы чекбокс «Разовое посещение» зафиксирован в ON и скрыт. */
  groupIsOneTime?: boolean
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

export function AddStudentDialog({ lessonId, groupIsOneTime = false }: AddStudentDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const [search, setSearch] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<StudentResult[]>([])

  const [addingKey, setAddingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setSearch("")
    setResults([])
    setError(null)
  }

  // Поиск
  useEffect(() => {
    if (!open) return
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
  }, [search, open, lessonId])

  async function add(student: StudentResult) {
    const key = `${student.clientId}:${student.wardId}`
    setAddingKey(key)
    setError(null)
    try {
      const res = await fetch(`/api/lessons/${lessonId}/add-student`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: student.clientId,
          wardId: student.wardId,
          isOneTime: true,
        }),
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
      setAddingKey(null)
    }
  }

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
          <DialogTitle>Добавить ученика</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          <Input
            placeholder="Поиск по ФИО ребёнка или родителя, телефону..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />

          {/* Через эту кнопку можно добавить только разовое посещение —
              чекбокс зафиксирован и не отключается. Для зачисления
              в группу нужен абонемент через воронку продаж. */}
          {!groupIsOneTime && (
            <label className="flex items-start gap-2 rounded-md border p-3 opacity-90">
              <Checkbox checked disabled className="mt-0.5" />
              <div>
                <div className="text-sm font-medium">Разовое посещение</div>
                <div className="text-xs text-muted-foreground">
                  Через эту кнопку можно добавить только разовое посещение.
                </div>
              </div>
            </label>
          )}

          <p className="text-xs text-muted-foreground">
            Ученик появится в списке как «Не отмечен». Списание происходит позже,
            при отметке «Был».
          </p>

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
              {results.map((r) => {
                const key = `${r.clientId}:${r.wardId}`
                const loading = addingKey === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => add(r)}
                    disabled={loading || !!addingKey}
                    className="flex w-full items-start justify-between rounded-lg border p-3 text-left hover:bg-accent disabled:opacity-60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{r.wardName}</div>
                      <div className="text-xs text-muted-foreground">
                        Родитель: {r.clientName}
                      </div>
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
                    <span className="ml-2 inline-flex items-center text-xs text-primary shrink-0">
                      {loading ? (
                        <>
                          <Loader2 className="mr-1 size-3 animate-spin" />
                          Добавление...
                        </>
                      ) : (
                        "Добавить →"
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Закрыть
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
