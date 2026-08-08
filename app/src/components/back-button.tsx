"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Стрелка «Назад». Ведёт себя как кнопка «Назад» в браузере: возвращает на
 * фактическую предыдущую страницу в истории (router.back()). Если истории нет
 * (прямой переход по ссылке, открытие в новой вкладке) — переходит по
 * `fallbackHref`. Ссылку оставляем настоящим href, чтобы средний клик /
 * «Открыть в новой вкладке» / Ctrl+клик работали корректно.
 *
 * По умолчанию рендерит иконку-кнопку (ghost, для шапок карточек). Для инлайн-
 * стрелок (muted-ссылка, ссылка с текстом) передайте `children` и `className` —
 * тогда компонент оборачивает их в ту же логику «назад».
 */
export function BackButton({
  fallbackHref,
  className,
  children,
  ariaLabel = "Назад",
}: {
  fallbackHref: string
  className?: string
  children?: React.ReactNode
  ariaLabel?: string
}) {
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
    <Link
      href={fallbackHref}
      onClick={handleClick}
      aria-label={ariaLabel}
      className={className}
    >
      {children ?? (
        <Button variant="ghost" size="icon">
          <ArrowLeft className="size-4" />
        </Button>
      )}
    </Link>
  )
}
