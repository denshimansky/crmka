"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ClipboardList, Trash2 } from "lucide-react"
import { formatWardName } from "@/lib/format-name"

interface ApplicationRow {
  id: string
  status: "active" | "processed"
  processedToStatus: "lead" | "potential" | "trial" | null
  processedAt: string | null
  createdAt: string
  comment: string | null
  ward: { id: string; firstName: string; lastName: string | null }
  branch: { id: string; name: string }
  direction: { id: string; name: string; color: string | null }
  processor: { id: string; firstName: string | null; lastName: string | null } | null
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
  return "—"
}

export function ApplicationsSection({
  clientId,
  canDelete = false,
}: {
  clientId: string
  canDelete?: boolean
}) {
  const router = useRouter()
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

  async function handleDelete(id: string) {
    if (!confirm("Удалить заявку?")) return
    try {
      const res = await fetch(`/api/applications/${id}`, { method: "DELETE" })
      if (res.ok) {
        setApplications((prev) => prev?.filter((a) => a.id !== id) ?? null)
        router.refresh()
      }
    } catch {
      /* ignore */
    }
  }

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
          {active.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <Badge variant="default" className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                Активная
              </Badge>
              <div className="flex-1 min-w-[200px]">
                <div className="font-medium">{wardName(a.ward)}</div>
                <div className="text-xs text-muted-foreground">
                  {a.direction.name} · {a.branch.name} · от {fmtDate(a.createdAt)}
                </div>
                {a.comment && <div className="text-xs text-muted-foreground mt-0.5">{a.comment}</div>}
              </div>
              {canDelete && (
                <Button size="sm" variant="ghost" onClick={() => handleDelete(a.id)} title="Удалить заявку">
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              )}
            </li>
          ))}

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
