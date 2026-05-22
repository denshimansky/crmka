"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ListChecks, UserCheck, Sparkles, CalendarPlus } from "lucide-react"
import { TrialLessonForm, type TrialFormPayload } from "./trial-lesson-form"

interface WardLite {
  id: string
  firstName: string
  lastName: string | null
}

type Step = "choose" | "trial"

export function ProcessApplicationDialog({
  applicationId,
  wardId,
  branchId,
  directionId,
  ward,
  open,
  onOpenChange,
}: {
  applicationId: string
  wardId: string
  branchId: string
  directionId: string
  ward: WardLite
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>("choose")
  const [loading, setLoading] = useState<null | "lead" | "potential" | "trial">(null)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep("choose")
    setError(null)
    setLoading(null)
  }

  async function process(outcome: "lead" | "potential") {
    setLoading(outcome)
    setError(null)
    try {
      const res = await fetch(`/api/applications/${applicationId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка обработки заявки")
        return
      }
      onOpenChange(false)
      reset()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(null)
    }
  }

  async function processTrial(payload: TrialFormPayload) {
    setLoading("trial")
    setError(null)
    try {
      const res = await fetch(`/api/applications/${applicationId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: "trial",
          trialPayload: {
            scheduledDate: payload.scheduledDate,
            groupId: payload.groupId,
            directionId: payload.directionId,
            instructorId: payload.instructorId,
            roomId: payload.roomId,
            startTime: payload.startTime,
            comment: payload.comment,
          },
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при записи на пробное")
        return
      }
      onOpenChange(false)
      reset()
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === "choose" ? "Обработка заявки" : "Запись на пробное по заявке"}
          </DialogTitle>
        </DialogHeader>

        {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        {step === "choose" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Выберите следующий шаг по заявке.
            </p>
            <div className="grid gap-2">
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => process("lead")}
                disabled={loading !== null}
              >
                <UserCheck className="size-4" />
                Лид — оставить в воронке как «Новый»
              </Button>
              <Button
                variant="outline"
                className="justify-start"
                onClick={() => process("potential")}
                disabled={loading !== null}
              >
                <Sparkles className="size-4" />
                Потенциал — перевести в «Потенциальный»
              </Button>
              <Button
                variant="default"
                className="justify-start"
                onClick={() => setStep("trial")}
                disabled={loading !== null}
              >
                <CalendarPlus className="size-4" />
                Записать на пробное
              </Button>
            </div>
            <DialogFooter className="mt-2">
              <DialogClose render={<Button variant="ghost" type="button" />}>Отмена</DialogClose>
            </DialogFooter>
          </div>
        )}

        {step === "trial" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setStep("choose")}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ListChecks className="size-3" />
              Назад к выбору
            </button>
            <TrialLessonForm
              wards={[ward]}
              lockedWardId={wardId}
              lockedDirectionId={directionId}
              lockedBranchId={branchId}
              onSubmit={processTrial}
              submitting={loading === "trial"}
              errorMessage={error}
              submitLabel="Записать на пробное"
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
