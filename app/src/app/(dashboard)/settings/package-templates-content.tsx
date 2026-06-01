"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Plus, Trash2, Save } from "lucide-react"

interface PackageTemplate {
  id: string
  lessonsCount: number
  validDays: number | null
  isActive: boolean
  sortOrder: number
}

interface DraftTemplate {
  id?: string
  lessonsCount: number | ""
  validDays: number | ""
  dirty: boolean
  saving?: boolean
}

interface Props {
  initialDefaultValidDays: number
  initialNotifyDaysBefore: number
}

export function PackageTemplatesContent({
  initialDefaultValidDays,
  initialNotifyDaysBefore,
}: Props) {
  const [defaultValidDays, setDefaultValidDays] = useState(initialDefaultValidDays)
  const [notifyDaysBefore, setNotifyDaysBefore] = useState(initialNotifyDaysBefore)
  const [orgSaving, setOrgSaving] = useState(false)
  const [error, setError] = useState("")

  const [templates, setTemplates] = useState<DraftTemplate[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/package-templates")
      if (res.ok) {
        const data: PackageTemplate[] = await res.json()
        setTemplates(
          data.map((t) => ({
            id: t.id,
            lessonsCount: t.lessonsCount,
            validDays: t.validDays ?? "",
            dirty: false,
          })),
        )
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function saveOrgDefaults() {
    setOrgSaving(true)
    setError("")
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageDefaultValidDays: defaultValidDays,
          packageExpiryNotifyDaysBefore: notifyDaysBefore,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось сохранить")
      }
    } catch {
      setError("Ошибка сети")
    } finally {
      setOrgSaving(false)
    }
  }

  async function saveTemplate(idx: number) {
    const t = templates[idx]
    if (!t || !Number.isFinite(Number(t.lessonsCount)) || Number(t.lessonsCount) < 1) {
      return
    }
    const body = {
      lessonsCount: Number(t.lessonsCount),
      validDays: t.validDays === "" ? null : Number(t.validDays),
    }
    setTemplates((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, saving: true } : p)),
    )
    try {
      const res = t.id
        ? await fetch(`/api/package-templates/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/package-templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Не удалось сохранить шаблон")
        return
      }
      const saved: PackageTemplate = await res.json()
      setTemplates((prev) =>
        prev.map((p, i) =>
          i === idx
            ? {
                id: saved.id,
                lessonsCount: saved.lessonsCount,
                validDays: saved.validDays ?? "",
                dirty: false,
              }
            : p,
        ),
      )
    } catch {
      setError("Ошибка сети")
    } finally {
      setTemplates((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, saving: false } : p)),
      )
    }
  }

  async function deleteTemplate(idx: number) {
    const t = templates[idx]
    if (!t) return
    if (!t.id) {
      setTemplates((prev) => prev.filter((_, i) => i !== idx))
      return
    }
    const res = await fetch(`/api/package-templates/${t.id}`, { method: "DELETE" })
    if (res.ok) {
      setTemplates((prev) => prev.filter((_, i) => i !== idx))
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Не удалось удалить шаблон")
    }
  }

  function addRow() {
    setTemplates((prev) => [
      ...prev,
      { lessonsCount: "", validDays: "", dirty: true },
    ])
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-5 space-y-4">
          <h3 className="font-medium">Общие настройки пакетов</h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Срок действия по умолчанию (дн.)</Label>
              <Input
                type="number"
                min={1}
                max={3650}
                value={defaultValidDays}
                onChange={(e) =>
                  setDefaultValidDays(Math.max(1, Number(e.target.value) || 60))
                }
                className="max-w-[200px]"
              />
              <p className="text-xs text-muted-foreground">
                Используется, если у шаблона не задан собственный срок.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Уведомлять о скором истечении (дн. до)</Label>
              <Input
                type="number"
                min={0}
                max={60}
                value={notifyDaysBefore}
                onChange={(e) =>
                  setNotifyDaysBefore(Math.max(0, Number(e.target.value) || 0))
                }
                className="max-w-[200px]"
              />
              <p className="text-xs text-muted-foreground">
                За сколько дней до сгорания админы получат уведомление.
              </p>
            </div>
          </div>

          <Button type="button" onClick={saveOrgDefaults} disabled={orgSaving}>
            {orgSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
            Сохранить
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Шаблоны пакетов</h3>
            <Button type="button" size="sm" variant="outline" onClick={addRow}>
              <Plus className="mr-1 size-4" />
              Добавить
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Готовые опции при продаже пакета. Срок можно оставить пустым — тогда возьмётся
            значение по умолчанию.
          </p>

          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto size-5 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              Шаблонов пока нет. Добавьте 4/8/12 — самые типичные опции.
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((t, idx) => (
                <div key={t.id ?? `new-${idx}`} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs">Занятий</Label>
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      value={t.lessonsCount}
                      onChange={(e) => {
                        const raw = e.target.value
                        const v = raw === "" ? "" : Math.max(1, Number(raw) || 1)
                        setTemplates((prev) =>
                          prev.map((p, i) =>
                            i === idx ? { ...p, lessonsCount: v, dirty: true } : p,
                          ),
                        )
                      }}
                    />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs">Срок (дн)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      placeholder={`по умолч. ${defaultValidDays}`}
                      value={t.validDays}
                      onChange={(e) => {
                        const raw = e.target.value
                        const v = raw === "" ? "" : Math.max(1, Number(raw) || 1)
                        setTemplates((prev) =>
                          prev.map((p, i) =>
                            i === idx ? { ...p, validDays: v, dirty: true } : p,
                          ),
                        )
                      }}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => saveTemplate(idx)}
                    disabled={!t.dirty || !!t.saving}
                  >
                    {t.saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Save className="size-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteTemplate(idx)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
