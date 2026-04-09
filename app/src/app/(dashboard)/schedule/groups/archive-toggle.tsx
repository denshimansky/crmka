"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Archive } from "lucide-react"

export function ArchiveToggle({ showArchived }: { showArchived: boolean }) {
  const router = useRouter()

  function toggle() {
    if (showArchived) {
      router.push("/schedule/groups")
    } else {
      router.push("/schedule/groups?showArchived=1")
    }
  }

  return (
    <Button
      variant={showArchived ? "secondary" : "outline"}
      size="sm"
      onClick={toggle}
    >
      <Archive className="mr-2 size-4" />
      {showArchived ? "Скрыть архивные" : "Показать архивные"}
    </Button>
  )
}
