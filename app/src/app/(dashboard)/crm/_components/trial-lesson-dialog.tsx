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
}: {
  clientId: string
  wards: WardLite[]
  lockedWardId?: string
  trigger?: ReactNode
  buttonLabel?: string
  buttonVariant?: "default" | "outline" | "secondary" | "ghost"
  buttonSize?: "default" | "sm" | "lg" | "icon"
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const noWards = wards.length === 0

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
          disabled={noWards}
          title={noWards ? "Сначала добавьте подопечного" : undefined}
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
      {trigger ?? defaultTrigger}

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
