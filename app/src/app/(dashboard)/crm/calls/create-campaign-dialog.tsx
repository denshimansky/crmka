"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import { Plus } from "lucide-react"

export function CreateCampaignDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")

  function reset() { setName(""); setError(null) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (!name) { setError("Введите название"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/call-campaigns", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filterCriteria: {} }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Ошибка"); return }
      reset(); setOpen(false); router.refresh()
    } catch { setError("Ошибка сети") } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger render={<Button />}><Plus className="mr-2 size-4" />Новый обзвон</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Новая кампания обзвона</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-1.5">
            <Label>Название *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Обзвон лидов март" />
          </div>
          <p className="text-xs text-muted-foreground">
            Все клиенты будут добавлены в кампанию. Фильтры — в следующей версии.
          </p>
          <DialogFooter><Button type="submit" disabled={loading}>{loading ? "Создание..." : "Создать обзвон"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
