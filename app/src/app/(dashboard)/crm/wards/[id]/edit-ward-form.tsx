"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BirthDateInput } from "@/components/birth-date-input"

interface EditWardFormProps {
  wardId: string
  initial: {
    firstName: string
    lastName: string | null
    birthDate: string // YYYY-MM-DD or ""
  }
}

export function EditWardForm({ wardId, initial }: EditWardFormProps) {
  const router = useRouter()
  const [firstName, setFirstName] = useState(initial.firstName)
  const [lastName, setLastName] = useState(initial.lastName ?? "")
  const [birthDate, setBirthDate] = useState(initial.birthDate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const dirty =
    firstName.trim() !== initial.firstName.trim() ||
    lastName.trim() !== (initial.lastName ?? "").trim() ||
    birthDate !== initial.birthDate

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOkMsg(null)
    if (!firstName.trim()) {
      setError("Имя обязательно")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/wards/${wardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim() || null,
          birthDate: birthDate || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || "Ошибка при сохранении")
        return
      }
      setOkMsg("Сохранено")
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Данные ребёнка</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          {okMsg && !error && (
            <div className="rounded-md bg-green-100 px-3 py-2 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
              {okMsg}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Имя *</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Имя" />
          </div>
          <div className="space-y-1.5">
            <Label>Фамилия</Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Фамилия" />
          </div>
          <div className="space-y-1.5">
            <Label>Дата рождения</Label>
            <BirthDateInput value={birthDate} onChange={setBirthDate} />
          </div>
          <Button type="submit" disabled={saving || !dirty} className="w-full">
            {saving ? "Сохранение..." : "Сохранить"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
