"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Стрелка «Назад» в шапках карточек. Ведёт себя как кнопка «Назад» в
 * браузере: возвращает на предыдущую страницу в истории. Если истории нет
 * (прямой переход по ссылке, открытие в новой вкладке) — переходит по
 * `fallbackHref`. Ссылку оставляем настоящим href, чтобы средний клик /
 * «Открыть в новой вкладке» работали корректно.
 */
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter()

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented) return
    if (e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (typeof window !== "undefined" && window.history.length > 1) {
      e.preventDefault()
      router.back()
    }
  }

  return (
    <Link href={fallbackHref} onClick={handleClick} aria-label="Назад">
      <Button variant="ghost" size="icon">
        <ArrowLeft className="size-4" />
      </Button>
    </Link>
  )
}
