"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Save, RotateCcw } from "lucide-react"
import { ALL_ROLES, DEFAULT_ROLE_DISPLAY_NAMES } from "@/lib/roles"
import type { Role } from "@prisma/client"

interface Props {
  initialValues: Record<string, string>
}

export function RoleDisplayNamesForm({ initialValues }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const merged: Record<string, string> = {}
    for (const role of ALL_ROLES) {
      merged[role] = initialValues[role] || DEFAULT_ROLE_DISPLAY_NAMES[role]
    }
    return merged
  })
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleChange = (role: Role, value: string) => {
    setValues((prev) => ({ ...prev, [role]: value }))
    setSuccess(false)
    setError(null)
  }

  const handleReset = () => {
    setValues({ ...DEFAULT_ROLE_DISPLAY_NAMES })
    setSuccess(false)
    setError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleDisplayNames: values }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Ошибка сохранения")
      }
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения")
    } finally {
      setSaving(false)
    }
  }

  const hasChanges = ALL_ROLES.some(
    (role) => values[role] !== (initialValues[role] || DEFAULT_ROLE_DISPLAY_NAMES[role]),
  )

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="mb-4 text-lg font-semibold">Названия ролей</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Настройте отображаемые названия ролей для вашей организации
        </p>
        <div className="space-y-3">
          {ALL_ROLES.map((role) => (
            <div key={role} className="flex items-center gap-4">
              <Label className="w-32 shrink-0 text-sm text-muted-foreground">
                {DEFAULT_ROLE_DISPLAY_NAMES[role]}
              </Label>
              <Input
                value={values[role] || ""}
                onChange={(e) => handleChange(role, e.target.value)}
                placeholder={DEFAULT_ROLE_DISPLAY_NAMES[role]}
                className="max-w-xs"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving || !hasChanges} size="sm">
            <Save className="mr-1.5 size-4" />
            {saving ? "Сохранение..." : "Сохранить"}
          </Button>
          <Button onClick={handleReset} variant="outline" size="sm">
            <RotateCcw className="mr-1.5 size-4" />
            По умолчанию
          </Button>
          {success && <span className="text-sm text-green-600">Сохранено</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
