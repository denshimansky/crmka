"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Pencil } from "lucide-react"

interface DirectionData {
  id: string
  name: string
  lessonPrice: string
  lessonDuration: number
  trialPrice: string | null
  trialFree: boolean
  color: string | null
}

export function EditDirectionDialog({ direction }: { direction: DirectionData }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(direction.name)
  const [lessonPrice, setLessonPrice] = useState(direction.lessonPrice)
  const [lessonDuration, setLessonDuration] = useState(String(direction.lessonDuration))
  const [trialFree, setTrialFree] = useState(direction.trialFree)
  const [trialPrice, setTrialPrice] = useState(direction.trialPrice ?? "")
  const [color, setColor] = useState(direction.color ?? "#3b82f6")

  function resetForm() {
    setName(direction.name)
    setLessonPrice(direction.lessonPrice)
    setLessonDuration(String(direction.lessonDuration))
    setTrialFree(direction.trialFree)
    setTrialPrice(direction.trialPrice ?? "")
    setColor(direction.color ?? "#3b82f6")
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) { setError("Название обязательно"); return }
    if (!lessonPrice || Number(lessonPrice) < 0) { setError("Укажите стоимость занятия"); return }

    setLoading(true)
    try {
      const res = await fetch(`/api/directions/${direction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          lessonPrice: Number(lessonPrice),
          lessonDuration: Number(lessonDuration) || 45,
          trialFree,
          trialPrice: !trialFree && trialPrice ? Number(trialPrice) : null,
          color,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
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
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      <DialogTrigger render={<Button variant="ghost" size="icon" />}>
        <Pencil className="size-4" />
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Редактирование направления</DialogTitle>
            <DialogDescription>Измените параметры направления обучения</DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            )}

            <div>
              <Label>Название *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Развивайка 3-4" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Стоимость занятия, ₽ *</Label>
                <Input type="number" min="0" value={lessonPrice} onChange={(e) => setLessonPrice(e.target.value)} placeholder="400" />
              </div>
              <div>
                <Label>Длительность, мин</Label>
                <Input type="number" min="15" max="480" value={lessonDuration} onChange={(e) => setLessonDuration(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={trialFree} onCheckedChange={(v) => setTrialFree(!!v)} />
                Бесплатное пробное занятие
              </label>
              {!trialFree && (
                <div>
                  <Label>Стоимость пробного, ₽</Label>
                  <Input type="number" min="0" value={trialPrice} onChange={(e) => setTrialPrice(e.target.value)} placeholder="500" />
                </div>
              )}
            </div>

            <div>
              <Label>Цвет</Label>
              <div className="flex items-center gap-2 mt-1">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-12 cursor-pointer rounded border" />
                <span className="text-sm text-muted-foreground">{color}</span>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" type="button" />}>Отмена</DialogClose>
            <Button type="submit" disabled={loading}>{loading ? "Сохранение..." : "Сохранить"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
