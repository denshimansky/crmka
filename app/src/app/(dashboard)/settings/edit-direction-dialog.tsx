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
import { Pencil } from "lucide-react"
import { DIRECTION_ICONS, DEFAULT_DIRECTION_ICON } from "@/lib/direction-icons"
import { useCurrencySymbol, useMoneyFormat } from "@/components/currency-provider"
import { cn } from "@/lib/utils"

interface DirectionData {
  id: string
  name: string
  lessonPrice: string
  lessonDuration: number
  trialPrice: string | null
  trialFree: boolean
  singleVisitPrice: string | null
  color: string | null
  icon: string | null
  packagePrices?: Record<string, number> | null
}

interface PackageTemplateOption {
  id: string
  lessonsCount: number
  validDays: number | null
}

function pricesToStrings(map: Record<string, number> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (map && typeof map === "object") {
    for (const [id, v] of Object.entries(map)) {
      if (v != null && Number.isFinite(Number(v))) out[id] = String(v)
    }
  }
  return out
}

// Запланированная будущая версия цены направления (баг #88).
interface ScheduledVersion {
  id: string
  effectiveFrom: string // ISO
  lessonPrice: string
  trialPrice: string | null
  trialFree: boolean
  singleVisitPrice: string | null
  packagePrices?: Record<string, number> | null
}

// ISO-дата → ДД.ММ.ГГГГ для показа.
function fmtDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}.${m}.${y}`
}

// Завтрашний день как ГГГГ-ММ-ДД (UTC) — минимум для даты новой цены.
function tomorrowIso(): string {
  const t = new Date()
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

export function EditDirectionDialog({ direction }: { direction: DirectionData }) {
  const router = useRouter()
  const sym = useCurrencySymbol()
  const money = useMoneyFormat()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(direction.name)
  const [lessonPrice, setLessonPrice] = useState(direction.lessonPrice)
  const [lessonDuration, setLessonDuration] = useState(String(direction.lessonDuration))
  const [trialFree, setTrialFree] = useState(direction.trialFree)
  const [trialPrice, setTrialPrice] = useState(direction.trialPrice ?? "")
  const [singleVisitPrice, setSingleVisitPrice] = useState(direction.singleVisitPrice ?? "")
  const [color, setColor] = useState(direction.color ?? "#3b82f6")
  const [icon, setIcon] = useState(direction.icon ?? DEFAULT_DIRECTION_ICON)

  const [isPackageOrg, setIsPackageOrg] = useState(false)
  const [templates, setTemplates] = useState<PackageTemplateOption[]>([])
  const [packagePrices, setPackagePrices] = useState<Record<string, string>>(() => pricesToStrings(direction.packagePrices))

  // Запланированные будущие изменения цены (баг #88).
  const [versions, setVersions] = useState<ScheduledVersion[]>([])
  const [showSchedule, setShowSchedule] = useState(false)
  const [schedFrom, setSchedFrom] = useState("")
  const [schedLessonPrice, setSchedLessonPrice] = useState("")
  const [schedTrialFree, setSchedTrialFree] = useState(false)
  const [schedTrialPrice, setSchedTrialPrice] = useState("")
  const [schedSingleVisit, setSchedSingleVisit] = useState("")
  const [schedPackagePrices, setSchedPackagePrices] = useState<Record<string, string>>({})
  const [impactCount, setImpactCount] = useState<number | null>(null)
  const [schedError, setSchedError] = useState<string | null>(null)
  const [schedSaving, setSchedSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const [orgRes, tplRes, verRes] = await Promise.all([
          fetch("/api/organization"),
          fetch("/api/package-templates"),
          fetch(`/api/directions/${direction.id}/prices`),
        ])
        if (orgRes.ok) {
          const org = await orgRes.json()
          if (!cancelled) setIsPackageOrg(org?.subscriptionType === "package")
        }
        if (tplRes.ok) {
          const tpls = (await tplRes.json()) as PackageTemplateOption[]
          if (!cancelled) setTemplates(Array.isArray(tpls) ? tpls : [])
        }
        if (verRes.ok) {
          const vers = (await verRes.json()) as ScheduledVersion[]
          if (!cancelled) setVersions(Array.isArray(vers) ? vers : [])
        }
      } catch {
        /* игнорируем — секция пакетов/расписания цен просто не покажется */
      }
    })()
    return () => { cancelled = true }
  }, [open, direction.id])

  // Перечитать список запланированных версий цены.
  async function reloadVersions() {
    try {
      const res = await fetch(`/api/directions/${direction.id}/prices`)
      if (res.ok) setVersions((await res.json()) as ScheduledVersion[])
    } catch { /* ignore */ }
  }

  // Счётчик уже выписанных абонементов будущего периода при вводе даты новой цены.
  useEffect(() => {
    if (!showSchedule || !/^\d{4}-\d{2}-\d{2}$/.test(schedFrom)) {
      setImpactCount(null)
      return
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/directions/${direction.id}/prices/impact?from=${schedFrom}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && typeof d.count === "number") setImpactCount(d.count) })
        .catch(() => { /* ignore */ })
    }, 250)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [showSchedule, schedFrom, direction.id])

  // Открыть подформу планирования: преднаполнить текущими значениями формы.
  function openSchedule() {
    setSchedError(null)
    setSchedFrom(tomorrowIso())
    setSchedLessonPrice(lessonPrice)
    setSchedTrialFree(trialFree)
    setSchedTrialPrice(trialPrice)
    setSchedSingleVisit(singleVisitPrice)
    setSchedPackagePrices({ ...packagePrices })
    setShowSchedule(true)
  }

  function buildSchedPackagePrices(): Record<string, number> | null {
    const out: Record<string, number> = {}
    for (const [id, v] of Object.entries(schedPackagePrices)) {
      if (v == null || v.trim() === "") continue
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) out[id] = n
    }
    return Object.keys(out).length ? out : null
  }

  async function handleScheduleSave() {
    setSchedError(null)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(schedFrom)) { setSchedError("Укажите дату вступления в силу"); return }
    if (!schedLessonPrice || Number(schedLessonPrice) < 0) { setSchedError("Укажите цену занятия"); return }
    setSchedSaving(true)
    try {
      const res = await fetch(`/api/directions/${direction.id}/prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effectiveFrom: schedFrom,
          lessonPrice: Number(schedLessonPrice),
          trialFree: schedTrialFree,
          trialPrice: !schedTrialFree && schedTrialPrice ? Number(schedTrialPrice) : null,
          singleVisitPrice: schedSingleVisit ? Number(schedSingleVisit) : null,
          packagePrices: buildSchedPackagePrices(),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setSchedError(d.error || "Не удалось сохранить")
        return
      }
      setShowSchedule(false)
      await reloadVersions()
    } catch {
      setSchedError("Ошибка сети")
    } finally {
      setSchedSaving(false)
    }
  }

  async function handleDeleteVersion(id: string) {
    try {
      const res = await fetch(`/api/directions/${direction.id}/prices/${id}`, { method: "DELETE" })
      if (res.ok) await reloadVersions()
    } catch { /* ignore */ }
  }

  function resetForm() {
    setName(direction.name)
    setLessonPrice(direction.lessonPrice)
    setLessonDuration(String(direction.lessonDuration))
    setTrialFree(direction.trialFree)
    setTrialPrice(direction.trialPrice ?? "")
    setSingleVisitPrice(direction.singleVisitPrice ?? "")
    setColor(direction.color ?? "#3b82f6")
    setIcon(direction.icon ?? DEFAULT_DIRECTION_ICON)
    setPackagePrices(pricesToStrings(direction.packagePrices))
    setError(null)
    setShowSchedule(false)
    setSchedError(null)
    setImpactCount(null)
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
    if (!lessonPrice || Number(lessonPrice) < 0) { setError("Укажите стоимость занятия"); return }
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
      const res = await fetch(`/api/directions/${direction.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          lessonPrice: Number(lessonPrice),
          lessonDuration: Number(lessonDuration) || 45,
          trialFree,
          trialPrice: !trialFree && trialPrice ? Number(trialPrice) : null,
          singleVisitPrice: singleVisitPrice ? Number(singleVisitPrice) : null,
          color,
          icon,
          packagePrices: buildPackagePrices(),
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
                <Label>Стоимость занятия, {sym} *</Label>
                <Input type="number" step="0.01" min="0" value={lessonPrice} onChange={(e) => setLessonPrice(e.target.value)} placeholder="400" />
              </div>
              <div>
                <Label>Длительность, мин</Label>
                <Input type="number" min="15" max="480" value={lessonDuration} onChange={(e) => setLessonDuration(e.target.value)} />
              </div>
            </div>

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

            {/* Запланированные изменения цены с датой вступления в силу (баг #88). */}
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Запланированные изменения цены</Label>
                {!showSchedule && (
                  <Button type="button" variant="outline" size="sm" onClick={openSchedule}>
                    Запланировать
                  </Button>
                )}
              </div>

              {versions.length === 0 && !showSchedule && (
                <p className="text-xs text-muted-foreground">
                  Можно повысить цену с определённой даты. Абонементы со стартом от этой даты
                  (в т.ч. выписанные заранее на будущий месяц) считаются по новой цене; уже
                  созданные абонементы не пересчитываются.
                </p>
              )}

              {versions.length > 0 && (
                <ul className="space-y-1">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between text-sm">
                      <span>
                        с <strong>{fmtDay(v.effectiveFrom)}</strong> — {Number(v.lessonPrice)} {sym}/занятие
                      </span>
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleDeleteVersion(v.id)}>
                        Удалить
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {showSchedule && (
                <div className="space-y-3 border-t pt-3">
                  {schedError && (
                    <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{schedError}</div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Действует с *</Label>
                      <Input type="date" min={tomorrowIso()} value={schedFrom} onChange={(e) => setSchedFrom(e.target.value)} />
                    </div>
                    <div>
                      <Label>Цена занятия, {sym} *</Label>
                      <Input type="number" step="0.01" min="0" value={schedLessonPrice} onChange={(e) => setSchedLessonPrice(e.target.value)} />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={schedTrialFree} onCheckedChange={(v) => setSchedTrialFree(!!v)} />
                    Бесплатное пробное занятие
                  </label>
                  {!schedTrialFree && (
                    <div>
                      <Label>Стоимость пробного, {sym}</Label>
                      <Input type="number" step="0.01" min="0" value={schedTrialPrice} onChange={(e) => setSchedTrialPrice(e.target.value)} />
                    </div>
                  )}
                  <div>
                    <Label>Стоимость разового, {sym}</Label>
                    <Input type="number" step="0.01" min="0" value={schedSingleVisit} onChange={(e) => setSchedSingleVisit(e.target.value)} placeholder="Если пусто — цена занятия" />
                  </div>

                  {isPackageOrg && templates.length > 0 && (
                    <div className="space-y-2">
                      <Label>Цены по пакетам</Label>
                      {templates.map((t) => (
                        <div key={t.id} className="flex items-center gap-2">
                          <span className="w-28 shrink-0 text-sm text-muted-foreground">{t.lessonsCount} занятий</span>
                          <Input type="number" step="0.01" min="0" value={schedPackagePrices[t.id] ?? ""} onChange={(e) => setSchedPackagePrices((p) => ({ ...p, [t.id]: e.target.value }))} placeholder={schedLessonPrice || "базовая"} />
                          <span className="shrink-0 text-sm text-muted-foreground">{sym}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    ⚠ Уже созданные абонементы <strong>не пересчитываются</strong> по новой цене.
                    {impactCount != null && impactCount > 0 && (
                      <> На период с {fmtDay(schedFrom)} уже выписано <strong>{impactCount}</strong> — они останутся по прежней цене.</>
                    )}
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setShowSchedule(false)}>Отмена</Button>
                    <Button type="button" size="sm" onClick={handleScheduleSave} disabled={schedSaving}>
                      {schedSaving ? "Сохранение..." : "Сохранить цену"}
                    </Button>
                  </div>
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
            <Button type="submit" disabled={loading}>{loading ? "Сохранение..." : "Сохранить"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
