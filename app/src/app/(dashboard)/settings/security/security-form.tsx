"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, ShieldCheck } from "lucide-react"

interface Props {
  initial: {
    hidePhonesFromInstructors: boolean
    restrictClientExport: boolean
  }
}

export function SecurityForm({ initial }: Props) {
  const router = useRouter()
  const [hidePhones, setHidePhones] = useState(initial.hidePhonesFromInstructors)
  const [restrictExport, setRestrictExport] = useState(initial.restrictClientExport)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    hidePhones !== initial.hidePhonesFromInstructors ||
    restrictExport !== initial.restrictClientExport

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/organization/security", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hidePhonesFromInstructors: hidePhones,
          restrictClientExport: restrictExport,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Не удалось сохранить")
        return
      }
      setSavedAt(new Date())
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        <div className="flex items-start gap-3 rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 shrink-0 mt-0.5 text-primary" />
          <p>
            Эти настройки влияют на то, что видят сотрудники в роли «инструктор», и
            кто может выгружать клиентскую базу. Изменения применяются сразу.
          </p>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={hidePhones}
            onCheckedChange={(v) => setHidePhones(v === true)}
            className="mt-0.5"
          />
          <div>
            <div className="text-sm font-medium">Скрывать номера телефонов у инструктора</div>
            <div className="text-xs text-muted-foreground">
              В таблицах клиентов, детей и в карточках занятий инструктор будет видеть
              «•••••» вместо номера. Остальные роли видят номер без изменений.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <Checkbox
            checked={restrictExport}
            onCheckedChange={(v) => setRestrictExport(v === true)}
            className="mt-0.5"
          />
          <div>
            <div className="text-sm font-medium">Запретить выгрузку клиентской базы</div>
            <div className="text-xs text-muted-foreground">
              Когда включено — выгрузку списка клиентов в Excel/CSV сможет сделать
              только владелец. Влияет на будущую функцию экспорта реестра
              «Контакты»/«Дети».
            </div>
          </div>
        </label>

        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-4">
          <div className="text-xs text-muted-foreground">
            {savedAt
              ? `Сохранено ${savedAt.toLocaleTimeString("ru-RU")}`
              : dirty
                ? "Есть несохранённые изменения"
                : "Все настройки сохранены"}
          </div>
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Сохранение...
              </>
            ) : (
              "Сохранить"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
