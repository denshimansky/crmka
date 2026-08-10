"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RotateCw } from "lucide-react"

/**
 * «Актуализировать» — пересобирает список контактов кампании под текущее
 * состояние базы (POST /api/call-campaigns/[id]/refresh) и показывает итог
 * «Добавлено N · Убрано M». Компактная кнопка в шапке страницы кампании;
 * показывается только для активной кампании.
 */
export function RefreshCampaignButton({ campaignId }: { campaignId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function actualize() {
    setLoading(true)
    setMessage(null)
    setError(null)
    try {
      const res = await fetch(`/api/call-campaigns/${campaignId}/refresh`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `Ошибка ${res.status}`)
        return
      }
      const added = Number(data.added ?? 0)
      const removed = Number(data.removed ?? 0)
      setMessage(
        added === 0 && removed === 0
          ? "Список актуален"
          : `Добавлено ${added} · Убрано ${removed}`,
      )
      router.refresh()
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {(message || error) && (
        <span className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
          {error ?? message}
        </span>
      )}
      <Button
        onClick={actualize}
        disabled={loading}
        size="sm"
        className="h-8 gap-1.5 px-3 text-sm font-medium shadow-sm"
      >
        <RotateCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        {loading ? "Актуализация…" : "Актуализировать"}
      </Button>
    </>
  )
}
