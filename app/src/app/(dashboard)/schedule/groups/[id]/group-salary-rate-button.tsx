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
  emptyRate,
  type RateFormValue,
} from "@/components/salary/salary-rate-form"

interface GroupRate {
  id: string
  scheme: keyof typeof SCHEME_LABELS
  ratePerStudent: string | null
  ratePerLesson: string | null
  fixedPerShift: string | null
  percentOfPayments: string | null
  brackets: { minStudents: number; ratePerLesson: string }[]
}

function rateToForm(r: GroupRate): RateFormValue {
  return {
    scheme: r.scheme,
    ratePerStudent: r.ratePerStudent ? Number(r.ratePerStudent) : null,
    ratePerLesson: r.ratePerLesson ? Number(r.ratePerLesson) : null,
    fixedPerShift: r.fixedPerShift ? Number(r.fixedPerShift) : null,
    percentOfPayments: r.percentOfPayments ? Number(r.percentOfPayments) : null,
    brackets: r.brackets.map((b) => ({
      minStudents: b.minStudents,
      ratePerLesson: Number(b.ratePerLesson),
    })),
  }
}

export function GroupSalaryRateButton({ groupId, groupName }: { groupId: string; groupName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [rate, setRate] = useState<GroupRate | null>(null)
  const [form, setForm] = useState<RateFormValue>(emptyRate())
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
        setForm(data ? rateToForm(data) : emptyRate())
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
          brackets: form.brackets,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось сохранить")
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    if (!confirm("Снять ставку группы? Расчёт ЗП вернётся к личным ставкам педагогов.")) return
    try {
      const res = await fetch(`/api/groups/${groupId}/salary-rate`, { method: "DELETE" })
      if (res.ok) {
        setOpen(false)
        setRate(null)
        router.refresh()
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Wallet className="mr-1 size-3.5" />
        {rate ? "Ставка группы: " + SCHEME_LABELS[rate.scheme] : "Задать ставку группы"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ставка группы «{groupName}»</DialogTitle>
            <DialogDescription>
              Если задана, перекрывает личные ставки всех педагогов, включая замещающего, на занятиях этой группы.
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
                  Текущая ставка перекрывает личные настройки педагогов.
                </div>
              )}
              <SalaryRateForm value={form} onChange={setForm} />
            </div>
          )}

          <DialogFooter className="gap-2">
            {rate && (
              <Button variant="ghost" onClick={handleRemove} className="text-destructive">
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
