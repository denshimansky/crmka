"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Wallet } from "lucide-react"
import {
  SalaryRateForm,
  SCHEME_LABELS,
  emptyGroupRate,
  type RateFormValue,
  type TrialPayMode,
} from "@/components/salary/salary-rate-form"

interface GroupRate {
  id: string
  scheme: keyof typeof SCHEME_LABELS
  ratePerStudent: string | null
  ratePerLesson: string | null
  fixedPerShift: string | null
  percentOfPayments: string | null
  trialPayMode: string | null
  brackets: { minStudents: number; ratePerLesson: string }[]
}

function rateToForm(r: GroupRate): RateFormValue {
  return {
    scheme: r.scheme,
    ratePerStudent: r.ratePerStudent ? Number(r.ratePerStudent) : null,
    ratePerLesson: r.ratePerLesson ? Number(r.ratePerLesson) : null,
    fixedPerShift: r.fixedPerShift ? Number(r.fixedPerShift) : null,
    percentOfPayments: r.percentOfPayments ? Number(r.percentOfPayments) : null,
    // NULL в БД = «По ставке инструктора» (наследование).
    trialPayMode: r.trialPayMode == null ? "inherit" : (r.trialPayMode as TrialPayMode),
    brackets: r.brackets.map((b) => ({
      minStudents: b.minStudents,
      ratePerLesson: Number(b.ratePerLesson),
    })),
  }
}

export function GroupSalaryRateButton({
  groupId,
  groupName,
  locked,
  initialScheme,
}: {
  groupId: string
  groupName: string
  // Замок: в группе уже есть реальная отметка — ставку менять нельзя (см.
  // lib/salary/group-rate-lock.ts). Кнопка становится неактивной.
  locked: boolean
  // Схема действующей ставки группы (или null) — чтобы лейбл кнопки был верным
  // без открытия диалога (диалог грузит полную ставку лениво).
  initialScheme: keyof typeof SCHEME_LABELS | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [rate, setRate] = useState<GroupRate | null>(null)
  const [form, setForm] = useState<RateFormValue>(emptyGroupRate())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/groups/${groupId}/salary-rate`)
      if (res.ok) {
        const data: GroupRate | null = await res.json()
        setRate(data)
        setForm(data ? rateToForm(data) : emptyGroupRate())
      }
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/groups/${groupId}/salary-rate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheme: form.scheme,
          ratePerStudent: form.ratePerStudent,
          ratePerLesson: form.ratePerLesson,
          fixedPerShift: form.fixedPerShift,
          percentOfPayments: form.percentOfPayments,
          // inherit → null: наследовать личную ставку инструктора для пробных.
          trialPayMode: form.trialPayMode === "inherit" ? null : form.trialPayMode,
          brackets: form.brackets,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось сохранить")
        return
      }
      // Сбрасываем локальный rate, чтобы лейбл кнопки взял свежую схему из
      // initialScheme после router.refresh() (иначе показывал бы старую).
      setRate(null)
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!confirm("Снять ставку группы? Расчёт ЗП вернётся к личным ставкам инструкторов.")) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/groups/${groupId}/salary-rate`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось снять ставку")
        return
      }
      setRate(null)
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const activeScheme = rate?.scheme ?? initialScheme
  const label = activeScheme
    ? "Ставка группы: " + SCHEME_LABELS[activeScheme]
    : "Задать ставку группы"

  return (
    <>
      {locked ? (
        <span
          className="inline-flex"
          title={
            activeScheme
              ? "В группе уже есть отметки — ставка группы зафиксирована и не редактируется"
              : "В группе уже есть отметки — задать ставку группы больше нельзя"
          }
        >
          <Button variant="outline" size="sm" disabled>
            <Wallet className="mr-1 size-3.5" />
            {label}
          </Button>
        </span>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Wallet className="mr-1 size-3.5" />
          {label}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ставка группы «{groupName}»</DialogTitle>
            <DialogDescription>
              Если задана, перекрывает личные ставки всех инструкторов, включая замещающего, на занятиях этой группы.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="text-sm text-muted-foreground">Загрузка...</div>
          ) : (
            <div className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              {rate && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">Действует</Badge>
                  Текущая ставка перекрывает личные настройки инструкторов.
                </div>
              )}
              <SalaryRateForm value={form} onChange={setForm} groupContext />
            </div>
          )}

          <DialogFooter className="gap-2">
            {rate && (
              <Button variant="ghost" onClick={handleRemove} disabled={saving} className="text-destructive">
                Снять ставку
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving ? "Сохранение..." : rate ? "Сохранить" : "Задать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
