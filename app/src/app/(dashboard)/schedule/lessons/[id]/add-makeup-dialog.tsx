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
import { UserPlus, Loader2, ArrowLeft, Clock, MapPin, AlertCircle } from "lucide-react"

type WardResult = {
  clientId: string
  clientName: string
  wardId: string
  wardName: string
  activeSubscriptionsCount: number
}

type EligibleLesson = {
  lessonId: string
  date: string
  startTime: string
  durationMinutes: number
  groupName: string
  directionName: string
  branchName: string | null
  instructorName: string
  attendanceCode: string | null
  attendanceLabel: string | null
  kind: "past" | "future"
}

export function AddMakeupDialog({
  lessonId,
  lessonDateISO,
}: {
  lessonId: string
  /** Дата текущего занятия (ISO YYYY-MM-DD) — для дефолта в выборе даты пропуска */
  lessonDateISO: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<"ward" | "lesson">("ward")

  const [search, setSearch] = useState("")
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<WardResult[]>([])
  const [selectedWard, setSelectedWard] = useState<WardResult | null>(null)

  const [date, setDate] = useState(lessonDateISO)
  const [eligibleLoading, setEligibleLoading] = useState(false)
  const [eligible, setEligible] = useState<EligibleLesson[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep("ward")
    setSearch("")
    setResults([])
    setSelectedWard(null)
    setDate(lessonDateISO)
    setEligible([])
    setError(null)
  }

  // Поиск ребёнка
  useEffect(() => {
    if (step !== "ward") return
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
          `/api/lessons/${lessonId}/makeup/search?q=${encodeURIComponent(q)}`,
        )
        if (!cancelled && res.ok) {
          const data = await res.json()
          setResults(data)
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

  // Загрузка eligible-lessons при изменении даты или выборе ребёнка
  useEffect(() => {
    if (step !== "lesson" || !selectedWard) return
    let cancelled = false
    setEligibleLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/clients/${selectedWard.clientId}/makeup-eligible-lessons?wardId=${selectedWard.wardId}&date=${date}&excludeLessonId=${lessonId}`,
        )
        if (cancelled) return
        if (res.ok) {
          setEligible(await res.json())
        } else {
          const d = await res.json().catch(() => ({}))
          setError(d.error || "Не удалось загрузить занятия")
        }
      } catch {
        if (!cancelled) setError("Ошибка сети")
      } finally {
        if (!cancelled) setEligibleLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [step, selectedWard, date, lessonId])

  async function submit(originalLessonId: string) {
    if (!selectedWard) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/lessons/${lessonId}/makeup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedWard.clientId,
          wardId: selectedWard.wardId,
          originalLessonId,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Ошибка при добавлении на отработку")
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
        Добавить на отработку
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {step === "ward" ? "Выберите ученика" : "Выберите занятие для отработки"}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === "ward" && (
          <div className="space-y-3">
            <Input
              placeholder="Поиск по ФИО ребёнка или родителя..."
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
                Ученики с активными абонементами не найдены
              </div>
            )}
            {results.length > 0 && (
              <div className="max-h-[300px] space-y-2 overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={`${r.clientId}-${r.wardId}`}
                    type="button"
                    onClick={() => {
                      setSelectedWard(r)
                      setStep("lesson")
                    }}
                    className="flex w-full items-center justify-between rounded-lg border p-3 text-left hover:bg-accent"
                  >
                    <div>
                      <div className="text-sm font-medium">{r.wardName}</div>
                      <div className="text-xs text-muted-foreground">
                        Родитель: {r.clientName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Активных абонементов: {r.activeSubscriptionsCount}
                      </div>
                    </div>
                    <span className="text-xs text-primary">Выбрать →</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "lesson" && selectedWard && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{selectedWard.wardName}</div>
                <div className="text-xs text-muted-foreground">
                  Родитель: {selectedWard.clientName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedWard(null)
                  setStep("ward")
                  setError(null)
                }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3" />
                Другой
              </button>
            </div>

            <div className="space-y-1.5">
              <Label>Дата пропущенного / будущего занятия</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            {eligibleLoading && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Загрузка занятий...
              </div>
            )}

            {!eligibleLoading && eligible.length === 0 && (
              <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                На эту дату занятий нет.<br />
                Выберите другую дату.
              </div>
            )}

            {!eligibleLoading && eligible.length > 0 && (
              <div className="max-h-[280px] space-y-2 overflow-y-auto">
                {eligible.map((l) => (
                  <div
                    key={l.lessonId}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span>{l.directionName}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">{l.groupName}</span>
                        {l.kind === "past" ? (
                          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                            {l.attendanceLabel || "пропуск"}
                          </span>
                        ) : (
                          <span className="rounded-sm bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                            будущее
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" />
                          {l.startTime} · {l.durationMinutes} мин
                        </span>
                        {l.branchName && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3" />
                            {l.branchName}
                          </span>
                        )}
                        <span>· {l.instructorName}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={submitting}
                      onClick={() => submit(l.lessonId)}
                    >
                      {submitting ? <Loader2 className="size-4 animate-spin" /> : "Отработать"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Отмена
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
