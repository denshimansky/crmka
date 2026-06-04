"use client"

import { useEffect, useState, type ReactNode } from "react"
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
import { formatWardName } from "@/lib/format-name"

interface WardLite {
  id: string
  firstName: string
  lastName: string | null
}

interface ActiveApplication {
  id: string
  wardId: string
  branchId: string
  directionId: string
  comment: string | null
  createdAt: string
  ward: { id: string; firstName: string; lastName: string | null }
  branch: { id: string; name: string }
  direction: { id: string; name: string }
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

  // Активные заявки клиента/подопечного — используются для пред-заполнения
  // полей пробного (филиал, направление). Если у ребёнка несколько заявок —
  // сначала пользователь выбирает, по какой создаём пробное.
  const [applications, setApplications] = useState<ActiveApplication[] | null>(null)
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setApplications(null)
      setSelectedAppId(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/applications?clientId=${clientId}&status=active`)
        if (!res.ok || cancelled) return
        let data: ActiveApplication[] = await res.json()
        // Если в модалку передан lockedWardId — оставляем только заявки этого ребёнка.
        if (lockedWardId) data = data.filter((a) => a.wardId === lockedWardId)
        if (cancelled) return
        setApplications(data)
        // Авто-выбор, если заявка одна.
        if (data.length === 1) setSelectedAppId(data[0].id)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, clientId, lockedWardId])

  const selectedApp = applications?.find((a) => a.id === selectedAppId) ?? null
  const needsAppPick = applications !== null && applications.length > 1 && !selectedApp

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

        {needsAppPick ? (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              У ребёнка несколько активных заявок. Выберите, по какой создаём пробное:
            </div>
            <div className="space-y-2">
              {applications!.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedAppId(a.id)}
                  className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted/40"
                >
                  <div className="font-medium">
                    {formatWardName(a.ward)} · {a.direction.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Филиал: {a.branch.name} · от {new Date(a.createdAt).toLocaleDateString("ru-RU")}
                    {a.comment ? ` · ${a.comment}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <TrialLessonForm
            wards={wards}
            lockedWardId={selectedApp?.wardId ?? lockedWardId}
            lockedDirectionId={selectedApp?.directionId}
            lockedBranchId={selectedApp?.branchId}
            onSubmit={handleSubmit}
            submitting={submitting}
            errorMessage={error}
            submitLabel="Записать"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
