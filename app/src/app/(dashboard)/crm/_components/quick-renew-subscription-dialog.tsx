"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { FileText } from "lucide-react"
import { formatWardName } from "@/lib/format-name"

interface ActiveSubscriptionOption {
  id: string
  directionName: string
  groupName: string
  branchName: string | null
  wardId: string | null
  wardName: string | null
  wardFirstName: string | null
  wardLastName: string | null
  lessonPrice: number
  periodYear: number | null
  periodMonth: number | null
}

const MONTH_LABELS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
]

function fmtMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU").format(amount) + " ₽"
}

function nextPeriodLabel(s: ActiveSubscriptionOption): string {
  const y = s.periodYear ?? new Date().getFullYear()
  const m = s.periodMonth ?? new Date().getMonth() + 1
  const nextM = m + 1
  const targetY = nextM > 12 ? y + 1 : y
  const targetM = nextM > 12 ? 1 : nextM
  return `${MONTH_LABELS[targetM - 1]} ${targetY}`
}

export function QuickRenewSubscriptionDialog({
  subscriptions,
}: {
  subscriptions: ActiveSubscriptionOption[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>(
    subscriptions.length === 1 ? subscriptions[0].id : "",
  )

  const disabled = subscriptions.length === 0
  const selected = subscriptions.find((s) => s.id === selectedId) ?? null

  async function handleSubmit() {
    if (!selectedId) {
      setError("Выберите абонемент для продления")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/subscriptions/${selectedId}/renew`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось продлить абонемент")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled}
            title={disabled ? "Нет действующих абонементов. Заведите заявку для нового направления." : undefined}
          />
        }
      >
        <FileText className="mr-2 size-4" />
        Абонемент
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Продление абонемента</DialogTitle>
          <DialogDescription>
            Параметры (группа, направление, цена) копируются из текущего абонемента.
            Для другого направления/группы — создайте Заявку.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          {subscriptions.length > 1 && (
            <div className="space-y-2">
              <Label>Какой продлеваем</Label>
              <div className="space-y-1.5">
                {subscriptions.map((s) => {
                  const wardLabel = s.wardId
                    ? formatWardName(
                        {
                          firstName: s.wardFirstName ?? "",
                          lastName: s.wardLastName,
                        },
                        "—",
                      )
                    : null
                  return (
                    <label
                      key={s.id}
                      className={`flex items-start gap-2 rounded-md border p-2 text-sm cursor-pointer ${
                        selectedId === s.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="renew-sub"
                        checked={selectedId === s.id}
                        onChange={() => setSelectedId(s.id)}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="font-medium">
                          {s.directionName} · {s.groupName}
                          {s.branchName ? ` · ${s.branchName}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {wardLabel ? `${wardLabel} · ` : ""}
                          {fmtMoney(s.lessonPrice)}/занятие
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          {selected && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="text-xs text-muted-foreground">Будет создан pending-абонемент на</div>
              <div className="font-medium">{nextPeriodLabel(selected)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Цена занятия зафиксирована: {fmtMoney(selected.lessonPrice)}. Количество занятий —
                по расписанию группы. Скидки пересчитаются автоматически.
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Отмена</DialogClose>
          <Button type="button" onClick={handleSubmit} disabled={loading || !selectedId}>
            {loading ? "Создание..." : "Создать pending"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
