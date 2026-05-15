"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"

export function DeleteLessonButton({ lessonId }: { lessonId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    if (!confirm("Удалить занятие? Действие необратимо.\n\nЕсли на занятии есть отметки или пробные — сначала их снимите.")) {
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/lessons/${lessonId}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/schedule")
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || "Ошибка удаления")
      }
    } catch {
      alert("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDelete}
      disabled={loading}
      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      title="Удалить занятие"
    >
      <Trash2 className="size-4" />
      {loading ? "Удаление..." : "Удалить"}
    </Button>
  )
}
