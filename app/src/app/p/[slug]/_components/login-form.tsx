"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Info } from "lucide-react"

interface Props {
  slug: string
  orgName: string
  fromLegacy: boolean
}

export function LoginForm({ slug, orgName, fromLegacy }: Props) {
  const router = useRouter()
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, phone, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Не удалось войти")
        return
      }
      router.push(`/p/${slug}/cabinet`)
      router.refresh()
    } catch {
      setError("Ошибка сети — попробуйте ещё раз")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold">{orgName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Личный кабинет</p>
        </div>

        {fromLegacy && (
          <p className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <Info className="mt-0.5 size-4 shrink-0" />
            Вход по ссылке отключён. Теперь вход — по телефону и паролю, их выдаёт ваш центр.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="portal-phone">Телефон</Label>
            <Input
              id="portal-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 900 000-00-00"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal-password">Пароль</Label>
            <Input
              id="portal-password"
              type="password"
              autoComplete="current-password"
              placeholder="xxxx-xxxx"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-11"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="h-11 w-full" disabled={loading}>
            {loading ? "Вход..." : "Войти"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Логин и пароль выдаёт администратор вашего центра. Если пароль потерялся — попросите
          выдать новый.
        </p>
      </CardContent>
    </Card>
  )
}
