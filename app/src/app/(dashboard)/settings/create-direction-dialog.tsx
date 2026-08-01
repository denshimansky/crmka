"use client"

import { useEffect, useState } from "react"
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
import { useCurrencySymbol, useMoneyFormat } from "@/components/currency-provider"
import { cn } from "@/lib/utils"

export interface CreatedDirection {
  id: string
  name: string
  lessonPrice: string | number
  color?: string | null
  icon?: string | null
  packagePrices?: Record<string, number> | null
}

interface PackageTemplateOption {
  id: string
  lessonsCount: number
  validDays: number | null
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
  const sym = useCurrencySymbol()
  const money = useMoneyFormat()
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

  const [isPackageOrg, setIsPackageOrg] = useState(false)
  const [templates, setTemplates] = useState<PackageTemplateOption[]>([])
  const [packagePrices, setPackagePrices] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const [orgRes, tplRes] = await Promise.all([
          fetch("/api/organization"),
          fetch("/api/package-templates"),
        ])
        if (orgRes.ok) {
          const org = await orgRes.json()
          if (!cancelled) setIsPackageOrg(org?.subscriptionType === "package")
        }
        if (tplRes.ok) {
          const tpls = (await tplRes.json()) as PackageTemplateOption[]
          if (!cancelled) setTemplates(Array.isArray(tpls) ? tpls : [])
        }
      } catch {
        /* игнорируем — секция пакетов просто не покажется */
      }
    })()
    return () => { cancelled = true }
  }, [open])

  function resetForm() {
    setName("")
    setLessonPrice("")
    setLessonDuration("45")
    setTrialFree(true)
    setTrialPrice("")
    setSingleVisitPrice("")
    setColor("#3b82f6")
    setIcon(DEFAULT_DIRECTION_ICON)
    setPackagePrices({})
    setError(null)
  }

  function buildPackagePrices(): Record<string, number> | null {
    const out: Record<string, number> = {}
    for (const [id, v] of Object.entries(packagePrices)) {
      if (v == null || v.trim() === "") continue
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) out[id] = n
    }
    return Object.keys(out).length ? out : null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) { setError("Название обязательно"); return }
    if (!lessonPrice || Number(lessonPrice) < 0) {
      setError(isPackageOrg ? "Укажите стоимость разового занятия" : "Укажите стоимость занятия")
      return
    }
    if (isPackageOrg && templates.length > 0) {
      const missing = templates.some((t) => {
        const raw = (packagePrices[t.id] ?? "").trim()
        const n = Number(raw)
        return raw === "" || !Number.isFinite(n) || n < 0
      })
      if (missing) { setError("Укажите цену занятия для каждого пакета"); return }
    }

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
          // Пакетный тип: разовое занятие = стоимость занятия → singleVisitPrice
          // не задаётся, бэкенд берёт lessonPrice (direction.singleVisitPrice ?? lessonPrice).
          singleVisitPrice: isPackageOrg ? null : singleVisitPrice ? Number(singleVisitPrice) : null,
          color,
          icon,
          packagePrices: buildPackagePrices(),
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

            {isPackageOrg ? (
              // Пакетный тип: цену занятия переносим вниз («Стоимость разового занятия») —
              // основная цена задаётся в блоке «Цены по пакетам».
              <div>
                <Label>Длительность занятия, мин</Label>
                <Input type="number" min="15" max="480" value={lessonDuration} onChange={(e) => setLessonDuration(e.target.value)} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Стоимость занятия, {sym} *</Label>
                  <Input type="number" step="0.01" min="0" value={lessonPrice} onChange={(e) => setLessonPrice(e.target.value)} placeholder="400" />
                </div>
                <div>
                  <Label>Длительность, мин</Label>
                  <Input type="number" min="15" max="480" value={lessonDuration} onChange={(e) => setLessonDuration(e.target.value)} />
                </div>
              </div>
            )}

            {isPackageOrg && templates.length > 0 && (
              <div className="space-y-2">
                <Label>Цены по пакетам *</Label>
                <div className="space-y-2">
                  {templates.map((t) => {
                    const raw = packagePrices[t.id] ?? ""
                    const per = Number(raw)
                    const hasPrice = raw.trim() !== "" && Number.isFinite(per) && per >= 0
                    return (
                      <div key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="w-24 shrink-0 text-sm text-muted-foreground">{t.lessonsCount} занятий</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-24"
                          value={raw}
                          onChange={(e) => setPackagePrices((prev) => ({ ...prev, [t.id]: e.target.value }))}
                          placeholder={lessonPrice || "400"}
                        />
                        <span className="shrink-0 text-sm text-muted-foreground">{sym}/за занятие</span>
                        {hasPrice && (
                          <span className="shrink-0 text-sm font-medium">= {money(per * t.lessonsCount)} за пакет</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={trialFree} onCheckedChange={(v) => setTrialFree(!!v)} />
                Бесплатное пробное занятие
              </label>
              {!trialFree && (
                <div>
                  <Label>Стоимость пробного, {sym}</Label>
                  <Input type="number" step="0.01" min="0" value={trialPrice} onChange={(e) => setTrialPrice(e.target.value)} placeholder="500" />
                </div>
              )}
            </div>

            {isPackageOrg ? (
              // Пакетный тип: «Стоимость разового занятия» = та же цена занятия
              // (в БД lessonPrice; отдельного «разового посещения» нет).
              <div>
                <Label>Стоимость разового занятия, {sym} *</Label>
                <Input type="number" step="0.01" min="0" value={lessonPrice} onChange={(e) => setLessonPrice(e.target.value)} placeholder="400" />
                <p className="mt-1 text-xs text-muted-foreground">
                  Цена одного занятия без пакета — списывается с баланса родителя, когда ученика добавляют на занятие без абонемента
                </p>
              </div>
            ) : (
              <div>
                <Label>Стоимость разового посещения, {sym}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={singleVisitPrice}
                  onChange={(e) => setSingleVisitPrice(e.target.value)}
                  placeholder="Если пусто — берём цену занятия"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Списывается с баланса родителя, когда ученика добавляют на конкретное занятие без абонемента
                </p>
              </div>
            )}

            <div>
              <Label>Цвет</Label>
              <div className="flex items-center gap-2 mt-1">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-12 cursor-pointer rounded border" />
                <span className="text-sm text-muted-foreground">{color}</span>
              </div>
            </div>

            <div>
              <Label>Иконка</Label>
              <div className="mt-2 grid grid-cols-8 gap-1.5 sm:grid-cols-10">
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
