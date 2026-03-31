"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Sparkles } from "lucide-react"

export function GenerateTasksButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleGenerate() {
    setLoading(true)
    try {
      const res = await fetch("/api/tasks/generate", { method: "POST" })
      const data = await res.json()
      if (data.created > 0) {
        alert(`Создано автозадач: ${data.created}`)
      } else {
        alert("Новых автозадач нет")
      }
      router.refresh()
    } catch {
      alert("Ошибка генерации")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleGenerate} disabled={loading}>
      <Sparkles className="mr-2 size-4" />
      {loading ? "Генерация..." : "Автозадачи"}
    </Button>
  )
}
