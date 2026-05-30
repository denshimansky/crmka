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
import { Plus } from "lucide-react"
import { DIRECTION_ICONS, DEFAULT_DIRECTION_ICON } from "@/lib/direction-icons"
import { cn } from "@/lib/utils"

export interface CreatedDirection {
  id: string
  name: string
  lessonPrice: string | number
  color?: string | null
  icon?: string | null
}

interface Props {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: (direction: CreatedDirection) => void
  hideTrigger?: boolean
  refreshOnSuccess?: boolean
}

export function CreateDirectionDialog({
  open: openProp,
  onOpenChange,
  onSuccess,
  hideTrigger,
  refreshOnSuccess = true,
}: Props = {}) {
  const router = useRouter()
  const [openInternal, setOpenInternal] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp! : openInternal
  const setOpen = (v: boolean) => {
    if (!isControlled) setOpenInternal(v)
    onOpenChange?.(v)
  }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState("")
  const [lessonPrice, setLessonPrice] = useState("")
  const [lessonDuration, setLessonDuration] = useState("45")
  const [trialFree, setTrialFree] = useState(true)
  const [trialPrice, setTrialPrice] = useState("")
  const [singleVisitPrice, setSingleVisitPrice] = useState("")
  const [color, setColor] = useState("#3b82f6")
  const [icon, setIcon] = useState(DEFAULT_DIRECTION_ICON)

  function resetForm() {
    setName("")
    setLessonPrice("")
    setLessonDuration("45")
    setTrialFree(true)
    setTrialPrice("")
    setSingleVisitPrice("")
    setColor("#3b82f6")
    setIcon(DEFAULT_DIRECTION_ICON)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) { setError("Название обязательно"); return }
    if (!lessonPrice || Number(lessonPrice) < 0) { setError("Укажите стоимость занятия"); return }

    setLoading(true)
    try {
      const res = await fetch("/api/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          lessonPrice: Number(lessonPrice),
          lessonDuration: Number(lessonDuration) || 45,
          trialFree,
          trialPrice: !trialFree && trialPrice ? Number(trialPrice) : undefined,
          singleVisitPrice: singleVisitPrice ? Number(singleVisitPrice) : null,
          color,
          icon,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при создании")
        return
      }

      const direction = (await res.json()) as CreatedDirection
      setOpen(false)
      resetForm()
      onSuccess?.(direction)
      if (refreshOnSuccess) router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm() }}>
      {!hideTrigger && (
        <DialogTrigger render={<Button size="sm" />}>
          <Plus className="size-4" />
          Направление
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Новое направление</DialogTitle>
            <DialogDescription>Укажите параметры направления обучения</DialogDescription>
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
              <Label>Стоимость разового посещения, ₽</Label>
              <Input
                type="number"
                min="0"
                value={singleVisitPrice}
                onChange={(e) => setSingleVisitPrice(e.target.value)}
                placeholder="Если пусто — берём цену занятия"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Списывается с баланса родителя, когда ученика добавляют на конкретное занятие без абонемента
              </p>
            </div>

            <div>
              <Label>Цвет</Label>
              <div className="flex items-center gap-2 mt-1">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-12 cursor-pointer rounded border" />
                <span className="text-sm text-muted-foreground">{color}</span>
              </div>
            </div>

            <div>
              <Label>Иконка</Label>
              <div className="mt-2 grid grid-cols-10 gap-1.5">
                {DIRECTION_ICONS.map(({ name, label, Icon }) => {
                  const selected = icon === name
                  return (
                    <button
                      key={name}
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-pressed={selected}
                      onClick={() => setIcon(name)}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md border transition-colors",
                        selected
                          ? "border-primary"
                          : "border-input text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                      style={selected ? { backgroundColor: `${color}20`, color } : undefined}
                    >
                      <Icon className="size-4" />
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline" type="button" />}>Отмена</DialogClose>
            <Button type="submit" disabled={loading}>{loading ? "Создание..." : "Создать"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
