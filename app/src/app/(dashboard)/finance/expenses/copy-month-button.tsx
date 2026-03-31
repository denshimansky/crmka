"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Copy } from "lucide-react"

export function CopyMonthButton({ currentYear, currentMonth }: { currentYear: number; currentMonth: number }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  // Предыдущий месяц
  const sourceMonth = currentMonth === 1 ? 12 : currentMonth - 1
  const sourceYear = currentMonth === 1 ? currentYear - 1 : currentYear

  const MONTH_NAMES = ["", "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"]

  async function handleCopy() {
    if (!confirm(`Скопировать повторяющиеся расходы с ${MONTH_NAMES[sourceMonth]} ${sourceYear}?`)) return

    setLoading(true)
    try {
      const res = await fetch("/api/expenses/copy-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceYear,
          sourceMonth,
          targetYear: currentYear,
          targetMonth: currentMonth,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Ошибка при копировании")
        return
      }

      const data = await res.json()
      alert(`Скопировано расходов: ${data.copied}`)
      router.refresh()
    } catch {
      alert("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleCopy} disabled={loading}>
      <Copy className="mr-2 size-4" />
      {loading ? "Копирование..." : "Скопировать с прошлого месяца"}
    </Button>
  )
}
