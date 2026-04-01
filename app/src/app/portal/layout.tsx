"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Sparkles, LogOut, User } from "lucide-react"

interface ClientSession {
  clientId: string
  tenantId: string
  clientName: string
  pdnConsent: boolean
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="text-muted-foreground">Загрузка...</div></div>}>
      <PortalLayoutInner>{children}</PortalLayoutInner>
    </Suspense>
  )
}

function PortalLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [client, setClient] = useState<ClientSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [needConsent, setNeedConsent] = useState(false)
  const [consenting, setConsenting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const token = searchParams.get("token")

    if (token) {
      // Авторизация по токену
      fetch(`/api/portal/auth?token=${token}`, { method: "POST" })
        .then((r) => {
          if (!r.ok) throw new Error("Недействительная ссылка")
          return r.json()
        })
        .then((data) => {
          setClient(data.client)
          if (!data.pdnConsent) setNeedConsent(true)
          // Убираем token из URL
          window.history.replaceState({}, "", "/portal")
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    } else {
      // Проверяем существующую сессию
      fetch("/api/portal/auth")
        .then((r) => {
          if (!r.ok) throw new Error("Не авторизован")
          return r.json()
        })
        .then((data) => {
          setClient(data.client)
          if (!data.client.pdnConsent) setNeedConsent(true)
        })
        .catch(() => setError("Для входа используйте ссылку от вашего центра"))
        .finally(() => setLoading(false))
    }
  }, [searchParams])

  const handleConsent = async () => {
    setConsenting(true)
    await fetch("/api/portal/consent", { method: "POST" })
    setNeedConsent(false)
    setConsenting(false)
    if (client) setClient({ ...client, pdnConsent: true })
  }

  const handleLogout = async () => {
    await fetch("/api/portal/auth", { method: "DELETE" })
    setClient(null)
    setError("Вы вышли из личного кабинета")
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <div className="flex size-12 mx-auto items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">Личный кабинет</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  if (needConsent) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-full max-w-md space-y-6 rounded-lg border bg-background p-8 shadow-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-6" />
            </div>
            <h1 className="text-xl font-semibold">Личный кабинет</h1>
            <p className="text-sm text-muted-foreground">Добро пожаловать, {client?.clientName}!</p>
          </div>

          <div className="space-y-4">
            <div className="rounded-md border p-4 text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">Согласие на обработку персональных данных</p>
              <p>Для использования личного кабинета необходимо согласиться с политикой конфиденциальности и обработкой персональных данных.</p>
              <p>Мы используем ваши данные исключительно для предоставления услуг: отображения расписания, баланса и абонементов.</p>
            </div>

            <button
              onClick={handleConsent}
              disabled={consenting}
              className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {consenting ? "Сохранение..." : "Согласен(на) с обработкой персональных данных"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <span className="text-sm font-semibold">Личный кабинет</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <User className="size-4 text-muted-foreground" />
              <span>{client?.clientName}</span>
            </div>
            <button onClick={handleLogout} title="Выйти" className="text-muted-foreground hover:text-destructive">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-4xl p-4">
        {children}
      </main>
    </div>
  )
}
