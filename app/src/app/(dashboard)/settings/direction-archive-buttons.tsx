"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Archive, RotateCcw } from "lucide-react"

/** Кнопка «В архив» на карточке активного направления (мягкое удаление — deletedAt). */
export function ArchiveDirectionButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function archive() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/directions/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при архивации")
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
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null) }}>
      <DialogTrigger render={<Button variant="ghost" size="icon" aria-label="В архив" />}>
        <Archive className="size-4" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Архивировать направление?</DialogTitle>
          <DialogDescription>
            «{name}» скроется из списков и выбора при создании групп/абонементов, но
            останется в истории. Действующие группы и абонементы не затрагиваются.
            Можно восстановить из архива.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>Отмена</DialogClose>
          <Button type="button" onClick={archive} disabled={loading}>
            {loading ? "Архивация..." : "В архив"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Кнопка «Восстановить» на карточке архивного направления. */
export function RestoreDirectionButton({ id }: { id: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function restore() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/directions/${id}/restore`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при восстановлении")
        return
      }
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={restore} disabled={loading} className="gap-1.5">
        <RotateCcw className="size-3.5" />
        {loading ? "..." : "Восстановить"}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
