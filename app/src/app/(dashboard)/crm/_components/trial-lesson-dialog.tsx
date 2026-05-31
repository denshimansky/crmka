"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CalendarPlus } from "lucide-react"
import { TrialLessonForm, type TrialFormPayload } from "./trial-lesson-form"

interface WardLite {
  id: string
  firstName: string
  lastName: string | null
}

export function TrialLessonDialog({
  clientId,
  wards,
  lockedWardId,
  trigger,
  buttonLabel = "Записать на пробное",
  buttonVariant = "outline",
  buttonSize = "sm",
  disabledReason,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: {
  clientId: string
  wards: WardLite[]
  lockedWardId?: string
  trigger?: ReactNode
  buttonLabel?: string
  buttonVariant?: "default" | "outline" | "secondary" | "ghost"
  buttonSize?: "default" | "sm" | "lg" | "icon"
  /** Если задан — кнопка-триггер disabled, текст показывается в title. Пробное
   *  без открытой заявки запрещено (см. API /api/trial-lessons). */
  disabledReason?: string
  /** Управляемый режим — для открытия модалки без триггера (например,
   *  из ПКМ в /crm/sales). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const router = useRouter()
  const isControlled = openProp !== undefined
  const [openInternal, setOpenInternal] = useState(false)
  const open = isControlled ? openProp : openInternal
  const setOpen = (v: boolean) => {
    if (isControlled) onOpenChangeProp?.(v)
    else setOpenInternal(v)
  }
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const noWards = wards.length === 0
  const disabled = noWards || Boolean(disabledReason)
  const title = noWards
    ? "Сначала добавьте подопечного"
    : disabledReason ?? undefined

  async function handleSubmit(payload: TrialFormPayload) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/trial-lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ...payload }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при записи на пробное")
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSubmitting(false)
    }
  }

  const defaultTrigger = (
    <DialogTrigger
      render={
        <Button
          variant={buttonVariant}
          size={buttonSize}
          disabled={disabled}
          title={title}
        />
      }
    >
      <CalendarPlus className="size-3.5" />
      {buttonLabel}
    </DialogTrigger>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setError(null)
      }}
    >
      {isControlled ? null : (trigger ?? defaultTrigger)}

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Запись на пробное занятие</DialogTitle>
        </DialogHeader>

        <TrialLessonForm
          wards={wards}
          lockedWardId={lockedWardId}
          onSubmit={handleSubmit}
          submitting={submitting}
          errorMessage={error}
          submitLabel="Записать"
        />
      </DialogContent>
    </Dialog>
  )
}
