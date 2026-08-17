"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import { PhoneOff } from "lucide-react"

const NO_ANSWER_CRITERIA = { mode: "no_answer" as const }

type PreviewState = { count: number } | "error" | null

/**
 * «Обзвон по не ответившим» — собирает в новую кампанию всех, у кого в ЛЮБОЙ из
 * уже созданных кампаний обзвона результат «Не ответил» (status=no_answer), чтобы
 * прозвонить их одним списком. Дальше внутри кампании работает кнопка
 * «Актуализировать» — она только ДОТЯГИВАЕТ новых не ответивших; никого из списка
 * не убирает (даже если контакту дозвонились в исходном обзвоне — он остаётся
 * здесь со статусом, который поставит оператор).
 */
export function CreateNoAnswerCampaignDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [preview, setPreview] = useState<PreviewState>(null)

  // При открытии — разовый предпросмотр размера выборки. Название НЕ префиллим:
  // авто-подстановку даты в имя убрали (оператор задаёт название сам).
  useEffect(() => {
    if (!open) return
    setPreview(null)
    let cancelled = false
    fetch("/api/call-campaigns/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filterCriteria: NO_ANSWER_CRITERIA }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("preview failed"))))
      .then((d) => { if (!cancelled) setPreview({ count: d.count }) })
      .catch(() => { if (!cancelled) setPreview("error") })
    return () => { cancelled = true }
  }, [open])

  function previewLabel(): string {
    if (preview === "error") return "Не удалось оценить выборку"
    if (preview) return `Найдено: ${preview.count} подопечных`
    return "Подбор выборки…"
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (!name.trim()) { setError("Введите название"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/call-campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), filterCriteria: NO_ANSWER_CRITERIA }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || `Ошибка ${res.status}`)
        return
      }
      setName(""); setOpen(false); router.refresh()
    } catch { setError("Ошибка сети") } finally { setLoading(false) }
  }

  return (
    // Пока идёт создание — диалог не закрываем (in-flight запрос записал бы ошибку
    // в уже закрытый диалог).
    <Dialog open={open} onOpenChange={(v) => { if (!v && loading) return; setOpen(v) }}>
      <DialogTrigger render={<Button variant="outline" />}>
        <PhoneOff className="mr-2 size-4" />Обзвон по не ответившим
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Обзвон по не ответившим</DialogTitle>
          <DialogDescription>
            В кампанию попадут все, у кого в уже созданных обзвонах результат «Не
            ответил». Позже кнопкой «Актуализировать» можно дотянуть новых не
            ответивших — уже добавленные контакты остаются в кампании (статус им
            ставите вы, обзвонив).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Не ответившие" />
          </div>
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">{previewLabel()}</span>
            <Button type="submit" disabled={loading}>{loading ? "Создание..." : "Создать обзвон"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
