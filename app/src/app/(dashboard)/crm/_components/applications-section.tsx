"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { ClipboardList } from "lucide-react"
import { formatWardName } from "@/lib/format-name"

type WardSalesStage = "none" | "application" | "trial_scheduled" | "trial_attended" | "awaiting_payment"

interface ApplicationRow {
  id: string
  status: "active" | "processed"
  // Этап воронки «Продажи» самой заявки — показываем его в бейдже (раньше было «Активная»).
  stage: WardSalesStage
  processedToStatus: "lead" | "potential" | "trial" | "won" | null
  processedAt: string | null
  createdAt: string
  comment: string | null
  ward: { id: string; firstName: string; lastName: string | null }
  branch: { id: string; name: string }
  direction: { id: string; name: string; color: string | null }
  processor: { id: string; firstName: string | null; lastName: string | null } | null
}

// Бейдж активной заявки = её этап воронки «Продажи» (1:1 со вкладками Продаж).
const STAGE_BADGE: Record<WardSalesStage, { label: string; className: string }> = {
  application: { label: "Заявка", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  trial_scheduled: { label: "Пробное", className: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30" },
  trial_attended: { label: "Прошёл пробное", className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30" },
  awaiting_payment: { label: "Ожидаем оплату", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  none: { label: "Активная", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
}

function wardName(w: ApplicationRow["ward"]): string {
  return formatWardName(w)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU")
}

function outcomeLabel(o: ApplicationRow["processedToStatus"]): string {
  if (o === "lead") return "Лид"
  if (o === "potential") return "Потенциал"
  if (o === "trial") return "Записан на пробное"
  if (o === "won") return "Купил"
  return "—"
}

export function ApplicationsSection({ clientId }: { clientId: string }) {
  const [applications, setApplications] = useState<ApplicationRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/applications?clientId=${clientId}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setApplications(data)
      } catch {
        /* ignore */
      }
    }
    load()
    // Перезагружаем список при создании/обработке заявки в этой же карточке —
    // CreateApplicationDialog диспатчит событие после успешного POST.
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ clientId: string }>).detail
      if (!detail || detail.clientId === clientId) load()
    }
    window.addEventListener("crm:applications-changed", onChange)
    return () => {
      cancelled = true
      window.removeEventListener("crm:applications-changed", onChange)
    }
  }, [clientId])

  if (applications === null) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">Загрузка заявок...</div>
    )
  }

  const active = applications.filter((a) => a.status === "active")
  const processedToShow = applications.filter((a) => a.status === "processed").slice(0, 3)

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ClipboardList className="size-4 text-muted-foreground" />
          Заявки
        </div>
        <span className="text-xs text-muted-foreground">
          активных: {active.length}
        </span>
      </div>

      {applications.length === 0 ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          Заявок пока нет. Создайте заявку из карточки выше — заявка должна предшествовать записи на пробное, когда выявлена потребность, но дата ещё не согласована.
        </div>
      ) : (
        <ul className="divide-y">
          {active.map((a) => {
            const badge = STAGE_BADGE[a.stage] ?? STAGE_BADGE.none
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Badge variant="default" className={badge.className}>{badge.label}</Badge>
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium">{wardName(a.ward)}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.direction.name} · {a.branch.name} · от {fmtDate(a.createdAt)}
                  </div>
                  {a.comment && <div className="text-xs text-muted-foreground mt-0.5">{a.comment}</div>}
                </div>
              </li>
            )
          })}

          {processedToShow.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm opacity-70">
              <Badge variant="secondary">Закрыта</Badge>
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{wardName(a.ward)}</div>
                <div className="text-xs text-muted-foreground">
                  {a.direction.name} · {a.branch.name} · → {outcomeLabel(a.processedToStatus)}
                  {a.processedAt && ` (${fmtDate(a.processedAt)})`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

    </div>
  )
}
