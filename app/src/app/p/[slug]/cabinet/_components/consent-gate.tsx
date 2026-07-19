"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

// Гейт согласий при первом входе (макет владельца): карточка центра с ИНН,
// чекбоксы-документы; кнопка активна после всех обязательных галочек.

export type GateItem = {
  type: string
  url: string
  required: boolean
  prefix: string
  linkLabel: string
  suffix: string | null
  granted: boolean
}

interface Props {
  orgName: string
  inn: string | null
  items: GateItem[]
  fallbackMode: boolean
}

export function ConsentGate({ orgName, inn, items, fallbackMode }: Props) {
  const router = useRouter()
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.type, i.granted]))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const allRequiredChecked = items.filter((i) => i.required).every((i) => checked[i.type])

  async function submit() {
    setSaving(true)
    setError("")
    try {
      const consents = fallbackMode
        ? [{ type: "pdn_parent", granted: true }]
        : items
            .filter((i) => checked[i.type] && !i.granted)
            .map((i) => ({ type: i.type, granted: true }))
      const res = await fetch("/api/portal/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consents }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Не удалось сохранить согласия")
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить согласия")
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold">{orgName}</h1>
          {inn && <p className="mt-1 text-sm text-muted-foreground">ИНН {inn}</p>}
        </div>

        {fallbackMode ? (
          <p className="mb-6 text-sm">
            Для доступа в личный кабинет необходимо согласие на обработку персональных данных —
            ваших и вашего ребёнка как законного представителя.
          </p>
        ) : (
          <div className="mb-6 space-y-4">
            {items.map((item) => (
              <label key={item.type} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked[item.type]}
                  disabled={item.granted || saving}
                  onChange={(e) =>
                    setChecked((prev) => ({ ...prev, [item.type]: e.target.checked }))
                  }
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                />
                <span className="text-sm leading-snug">
                  {item.prefix}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {item.linkLabel}
                  </a>
                  {item.suffix}
                  {!item.required && <span className="text-muted-foreground"> (необязательно)</span>}
                </span>
              </label>
            ))}
          </div>
        )}

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        <Button
          className="h-11 w-full"
          disabled={saving || (!fallbackMode && !allRequiredChecked)}
          onClick={submit}
        >
          {saving ? "Сохранение..." : "Войти в кабинет"}
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {fallbackMode
            ? "Нажимая кнопку, вы даёте согласие на обработку персональных данных"
            : "Кнопка активна после отметки всех обязательных согласий"}
        </p>
      </CardContent>
    </Card>
  )
}
