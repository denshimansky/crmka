"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"

/** Явная кнопка «Убрать из связи» для вкладки «Продажи → Связь».
 *  Раньше клиента убирали, вручную очищая дату «След. связь» в инлайн-ячейке —
 *  строка молча исчезала (непрозрачно). Кнопка делает то же (nextContactDate=null),
 *  но с подтверждением и понятной подписью. Клиент остаётся в базе — уходит только
 *  из этого списка. Аналог «Удалить из воронки» на остальных вкладках. */
export function RemoveFromContactButton({ clientId, name }: { clientId: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (
      !confirm(
        `Убрать «${name}» из вкладки «Связь»? Дата следующей связи будет очищена — клиент останется в базе, но исчезнет из этого списка.`,
      )
    )
      return
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextContactDate: null }),
      })
      if (res.ok) router.refresh()
      else alert("Не удалось убрать из связи. Попробуйте ещё раз.")
    } catch {
      alert("Ошибка сети. Попробуйте ещё раз.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={remove}
      disabled={busy}
      title="Убрать из вкладки «Связь» (очистить дату связи)"
      aria-label="Убрать из связи"
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </Button>
  )
}
