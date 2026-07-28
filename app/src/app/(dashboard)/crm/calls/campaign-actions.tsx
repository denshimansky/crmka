"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Archive, ArchiveRestore } from "lucide-react"

/**
 * Ячейка действий строки кампании обзвона.
 *
 * «Архивировать» переводит кампанию в статус `archived`: она уходит в конец
 * списка с пометкой «Архивный» и становится доступной только для просмотра —
 * кнопка «Результат» у контактов внутри становится неактивной. Действие
 * обратимо — «Разархивировать» возвращает кампанию в `active`.
 */
export function CampaignActionsCell({
  campaignId,
  status,
  campaignName,
}: {
  campaignId: string
  status: string
  campaignName: string
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setStatus(next: "archived" | "active") {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/call-campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Ошибка ${res.status}`)
        return
      }
      setConfirmOpen(false)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  if (status === "archived") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        disabled={loading}
        onClick={() => setStatus("active")}
      >
        <ArchiveRestore className="mr-1 size-3.5" />
        Разархивировать
      </Button>
    )
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={() => { setError(null); setConfirmOpen(true) }}
      >
        <Archive className="mr-1 size-3.5" />
        Архивировать
      </Button>

      <Dialog open={confirmOpen} onOpenChange={(v) => { if (!loading) setConfirmOpen(v) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="size-5" />
              Архивировать кампанию?
            </DialogTitle>
            <DialogDescription className="pt-2 text-foreground">
              Кампания «{campaignName}» переместится в конец списка с пометкой
              «Архивный». Её можно будет открыть и просмотреть, но зафиксировать
              результат звонка станет нельзя — кнопка «Результат» станет
              неактивной. Действие обратимо — кампанию можно вернуть кнопкой
              «Разархивировать».
            </DialogDescription>
          </DialogHeader>
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={loading}>
              Отмена
            </Button>
            <Button onClick={() => setStatus("archived")} disabled={loading}>
              {loading ? "Архивирование…" : "Архивировать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
