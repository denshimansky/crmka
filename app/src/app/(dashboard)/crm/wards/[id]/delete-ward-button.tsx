"use client"

// Удаление подопечного — только владелец (кнопку рендерит серверная страница
// по роли; API дублирует проверку). Удаляется только «чистый» ребёнок без
// абонементов/зачислений/пробных/заявок/посещений — иначе сервер откажет,
// и текст ошибки показывается прямо в диалоге.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"

interface DeleteWardButtonProps {
  wardId: string
  wardName: string
  /** Карточка родителя — туда возвращаемся после удаления. */
  clientId: string
}

export function DeleteWardButton({ wardId, wardName, clientId }: DeleteWardButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/wards/${wardId}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось удалить подопечного")
        return
      }
      router.push(`/crm/clients/${clientId}`)
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <Trash2 className="mr-2 size-4" />
        Удалить подопечного
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-card shadow-lg">
            <div className="border-b p-4">
              <div className="text-base font-semibold">Удалить подопечного?</div>
              <div className="text-sm text-muted-foreground mt-0.5">{wardName}</div>
            </div>

            <div className="space-y-3 p-4 text-sm">
              <div className="rounded-md bg-amber-100 px-3 py-2 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                Действие <strong>безвозвратно</strong> — карточка ребёнка будет удалена
                из базы. Используйте для случайно или неверно заведённых подопечных.
              </div>
              <p className="text-muted-foreground">
                Удалить можно только ребёнка без истории: если есть абонементы,
                зачисления, пробные, заявки или посещения — система откажет
                (такого ребёнка отчисляют, а не удаляют).
              </p>
              {error && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                  {error}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t p-3">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
                Отмена
              </Button>
              <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Удаление..." : "Удалить"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
